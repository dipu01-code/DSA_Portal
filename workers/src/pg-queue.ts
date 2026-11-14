import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import type { Pool } from 'pg';
import { judgeSubmission, LeaseLostError, type JudgeDeps } from './judge';
import { QueueMetrics, type JobOutcome } from './metrics';

export const QUEUE_CHANNEL = 'submission_queued'; // fired by the trigger in migrations 002/003

export interface QueueConfig {
  /** Total tries per submission, crashed/stalled runs included. Then it goes to the dead-letter list. */
  maxAttempts: number;
  /** Retry n waits backoffMs * 2^(n-1). */
  backoffMs: number;
  /** A running job whose lease is not renewed for this long is stalled and gets re-claimed. */
  leaseMs: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  leaseMs: 30000,
};

export interface Claim {
  id: string;
  /** New on every claim: only the current holder can renew, finish or fail the job. */
  token: string;
  attempts: number;
}

/**
 * Atomically claims the oldest runnable submission: queued and past its backoff, or running
 * with an expired lease (its worker died). SKIP LOCKED lets many workers (threads or machines)
 * claim in parallel without ever handing the same row to two of them at once.
 */
export async function claimNext(
  pool: Pool,
  leaseMs = DEFAULT_QUEUE_CONFIG.leaseMs
): Promise<Claim | null> {
  const { rows } = await pool.query<Claim>(
    `UPDATE submissions
     SET status = 'running', attempts = attempts + 1, lock_token = gen_random_uuid(),
         locked_until = now() + $1 * interval '1 millisecond'
     WHERE id = (
       SELECT id FROM submissions
       WHERE (status = 'queued' AND run_after <= now())
          OR (status = 'running' AND (locked_until IS NULL OR locked_until < now()))
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, lock_token AS token, attempts`,
    [leaseMs]
  );
  return rows[0] ?? null;
}

/** Renews the lease. False means another worker owns the job now. Doubles as the "may I save?" check. */
export async function extendLease(pool: Pool, claim: Claim, leaseMs: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE submissions SET locked_until = now() + $3 * interval '1 millisecond'
     WHERE id = $1 AND lock_token = $2 AND status = 'running'`,
    [claim.id, claim.token, leaseMs]
  );
  return rowCount === 1;
}

/**
 * After an infrastructure error: back to `queued` with exponential backoff, or to the
 * dead-letter list (`failed`) once attempts are used up. Null if we no longer own the row
 * (e.g. the result was already saved and only the stats hook failed).
 */
export async function failJob(
  pool: Pool,
  claim: Claim,
  error: string,
  cfg: QueueConfig
): Promise<'retried' | 'dead' | null> {
  const { rows } = await pool.query<{ status: string }>(
    `UPDATE submissions SET
       status = CASE WHEN attempts < $3 THEN 'queued' ELSE 'failed' END::submission_status,
       run_after = now() + ($4 * power(2, attempts - 1)) * interval '1 millisecond',
       judged_at = CASE WHEN attempts < $3 THEN NULL ELSE now() END,
       last_error = left($5, 1000), lock_token = NULL, locked_until = NULL
     WHERE id = $1 AND lock_token = $2 AND status = 'running'
     RETURNING status::text`,
    [claim.id, claim.token, cfg.maxAttempts, cfg.backoffMs, error]
  );
  if (!rows[0]) return null;
  return rows[0].status === 'queued' ? 'retried' : 'dead';
}

export interface WorkerOptions {
  pool: Pool;
  deps: JudgeDeps;
  concurrency: number;
  pollMs: number;
  queue?: Partial<QueueConfig>;
  metrics?: QueueMetrics;
  log?: Pick<Console, 'info' | 'error'>;
}

/** Starts `concurrency` claim-and-judge loops. stop() lets in-flight jobs finish first. */
export async function startWorker({
  pool,
  deps,
  concurrency,
  pollMs,
  queue,
  metrics = new QueueMetrics(),
  log = console,
}: WorkerOptions) {
  const cfg: QueueConfig = { ...DEFAULT_QUEUE_CONFIG, ...queue };
  let stopping = false;
  const wake = new EventEmitter();
  wake.setMaxListeners(0);

  // shortcut: if this LISTEN connection drops we fall back to polling every pollMs; add a reconnect if NOTIFY latency matters.
  const listener = await pool.connect();
  listener.on('error', (err) => log.error('[worker] LISTEN connection error', err));
  listener.on('notification', () => wake.emit('job'));
  await listener.query(`LISTEN ${QUEUE_CHANNEL}`);

  // shortcut: retries in backoff and stalled jobs are found by polling (pollMs granularity), not by a timer per job.
  const idle = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wake.off('job', done);
        resolve();
      };
      const timer = setTimeout(done, pollMs);
      wake.once('job', done);
    });

  const record = (n: number, claim: Claim, outcome: JobOutcome, extra = '') => {
    metrics.jobs[outcome]++;
    log.info(`[worker ${n}] ${claim.id} attempt=${claim.attempts} ${outcome} ${extra}`.trimEnd());
  };

  const loop = async (n: number) => {
    while (!stopping) {
      let claim: Claim | null = null;
      try {
        claim = await claimNext(pool, cfg.leaseMs);
        if (!claim) {
          await idle();
          continue;
        }
        const c = claim;
        if (c.attempts > cfg.maxAttempts) {
          // Every earlier attempt died mid-job (poison pill or crash loop): stop retrying it.
          const outcome = await failJob(pool, c, 'worker stopped mid-job on every attempt', cfg);
          if (outcome) record(n, c, outcome);
          continue;
        }
        const started = performance.now();
        const heartbeat = setInterval(
          () => void extendLease(pool, c, cfg.leaseMs).catch(() => {}),
          cfg.leaseMs / 3
        );
        try {
          const s = await judgeSubmission(c.id, deps, () => extendLease(pool, c, cfg.leaseMs));
          metrics.observe((performance.now() - started) / 1000);
          record(n, c, 'judged', `${s.status} ${s.result?.status ?? ''}`);
        } finally {
          clearInterval(heartbeat);
        }
      } catch (err) {
        if (!claim) {
          log.error(`[worker ${n}] claim failed`, err);
          await idle(); // DB down: back off instead of spinning
        } else if (err instanceof LeaseLostError) {
          record(n, claim, 'lease_lost'); // another worker took over; it will save the result
        } else {
          log.error(`[worker ${n}] job ${claim.id} failed`, err);
          // Only if we still own it: an error after the result was saved (e.g. the stats hook) must not erase it.
          const outcome = await failJob(
            pool,
            claim,
            String((err as Error)?.message ?? err),
            cfg
          ).catch(() => null);
          if (outcome) record(n, claim, outcome);
        }
      }
    }
  };

  const loops = Array.from({ length: concurrency }, (_, i) => loop(i + 1));
  log.info(
    `[worker] started: concurrency=${concurrency}, poll=${pollMs}ms, maxAttempts=${cfg.maxAttempts}, backoff=${cfg.backoffMs}ms, lease=${cfg.leaseMs}ms`
  );

  return {
    metrics,
    async stop() {
      stopping = true;
      wake.emit('job'); // release idle loops now
      await Promise.all(loops);
      await listener.query(`UNLISTEN ${QUEUE_CHANNEL}`).catch(() => {});
      listener.release();
    },
  };
}
