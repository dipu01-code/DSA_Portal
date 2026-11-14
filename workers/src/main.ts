// Worker process entry point: `npm run start -w workers` (after `npm run build`).
import { availableParallelism } from 'os';
import { pool, closePool } from '@dsa-portal/server/dist/db/pool';
import {
  PostgresProblemRepository,
  PostgresSubmissionRepository,
} from '@dsa-portal/server/dist/db/repositories';
import { PostgresDailyChallengeStore, utcDate } from '@dsa-portal/server/dist/modules/daily/store';
import { statsServiceStub } from './judge';
import { serveMetrics } from './metrics';
import { DEFAULT_QUEUE_CONFIG, startWorker } from './pg-queue';

const intEnv = (name: string, fallback: number, min: number) =>
  Math.max(min, Number(process.env[name]) || fallback);

async function main() {
  const worker = await startWorker({
    pool,
    deps: {
      problems: new PostgresProblemRepository(),
      submissions: new PostgresSubmissionRepository(),
      stats: statsServiceStub,
    },
    // One judging loop per core: each loop runs one sandbox child at a time, so this keeps every core busy (Day 9 load test).
    concurrency: intEnv('WORKER_CONCURRENCY', availableParallelism(), 1),
    pollMs: intEnv('WORKER_POLL_MS', 2000, 100),
    queue: {
      maxAttempts: intEnv('WORKER_MAX_ATTEMPTS', DEFAULT_QUEUE_CONFIG.maxAttempts, 1),
      backoffMs: intEnv('WORKER_BACKOFF_MS', DEFAULT_QUEUE_CONFIG.backoffMs, 0),
      leaseMs: intEnv('WORKER_LEASE_MS', DEFAULT_QUEUE_CONFIG.leaseMs, 1000),
    },
  });

  const metricsPort = Number(process.env.WORKER_METRICS_PORT) || 0;
  const metricsServer = metricsPort ? serveMetrics(metricsPort, worker.metrics, pool) : null;
  if (metricsServer) console.info(`[worker] metrics on :${metricsPort}/metrics`);

  // Daily challenge (instead of a BullMQ repeatable job, CR-021): create today's row at startup and just
  // after each UTC midnight. Its insert fires daily:new once, however many workers race (ON CONFLICT).
  const daily = new PostgresDailyChallengeStore();
  const ensureDaily = () =>
    daily
      .getOrCreate(utcDate())
      .catch((err) => console.error('[worker] daily challenge failed', err));
  const DAY_MS = 24 * 60 * 60 * 1000;
  let dailyTimer: NodeJS.Timeout;
  const scheduleDaily = () => {
    dailyTimer = setTimeout(
      () => {
        void ensureDaily();
        scheduleDaily();
      },
      DAY_MS - (Date.now() % DAY_MS) + 1000
    ); // epoch ms are UTC, so this lands 1 s after midnight UTC
  };
  void ensureDaily();
  scheduleDaily();

  // Finish in-flight submissions, then exit. A worker killed harder than this (SIGKILL, OOM)
  // stops renewing its lease, and another worker re-claims the job once the lease runs out.
  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal}: finishing current jobs...`);
    metricsServer?.close();
    clearTimeout(dailyTimer);
    await worker.stop();
    await closePool();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(async (err) => {
  console.error('[worker] failed to start', err);
  await closePool().catch(() => {});
  process.exit(1);
});
