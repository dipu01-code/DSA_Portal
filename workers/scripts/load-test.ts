/**
 * Day 9 load test: N concurrent submissions (default 100, one per user) against the real built API and worker(s).
 *
 *   npm run build && DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npm run load -w workers
 *
 * Env: LOAD_N (100), LOAD_WORKERS (worker processes, 1), WORKER_CONCURRENCY (passed to each worker; unset = its default),
 * LOAD_LABEL (row name in the output). Prints p50/p95/p99 for "accepted" (POST → 202) and "end-to-end"
 * (created_at → judged_at, from the database, so polling adds no error), throughput and error rate.
 * Uses, then deletes, its own users. Plain fetch, no k6/autocannon dependency.
 */
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { createServer, type AddressInfo } from 'net';
import * as path from 'path';
import { createSigner } from 'fast-jwt';

const DB_URL = process.env.DATABASE_URL;
const ROOT = path.join(__dirname, '../..');
const N = Number(process.env.LOAD_N) || 100;
const WORKERS = Number(process.env.LOAD_WORKERS) || 1;
const SECRET = 'load-test-secret';
const TWO_SUM =
  'function solve({ nums, target }) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
};
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

async function main() {
  if (!DB_URL) throw new Error('Set DATABASE_URL to a migrated test database');
  const { pool, closePool } = await import('../../server/src/db/pool');
  const { migrateUp } = await import('../../server/src/db/migrate');
  const { PostgresProblemRepository } = await import('../../server/src/db/repositories');
  const { SEED_PROBLEMS } = await import('../../server/src/db/seeds/problems-data');
  await migrateUp();
  const problems = new PostgresProblemRepository();
  if (!(await problems.findById('two-sum'))) {
    await problems.save(SEED_PROBLEMS.find((p) => p.id === 'two-sum')!);
  }

  // One user per submission, as N people submitting at once (so per-user quotas and limits behave as in production).
  const tag = Date.now().toString(36);
  const users = Array.from({ length: N }, (_, i) => ({
    id: randomUUID(),
    name: `load_${tag}_${i}`,
  }));
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash)
     SELECT id, name, name || '@load.test', 'x' FROM unnest($1::uuid[], $2::text[]) AS u(id, name)`,
    [users.map((u) => u.id), users.map((u) => u.name)]
  );
  const sign = createSigner({ key: SECRET, expiresIn: 3_600_000 });

  const procs: ChildProcess[] = [];
  let log = '';
  const start = (script: string, env: Record<string, string | undefined>) => {
    const p = spawn(process.execPath, [path.join(ROOT, script)], {
      env: { PATH: process.env.PATH, DATABASE_URL: DB_URL, ...env },
    });
    p.stdout!.on('data', (d) => (log += d));
    p.stderr!.on('data', (d) => (log += d));
    procs.push(p);
  };
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  start('server/dist/index.js', {
    PORT: String(port),
    JWT_SECRET: SECRET,
    LOG_LEVEL: 'warn',
    QUEUE_MAX_WAITING: '100000',
    RATE_LIMIT_IP_PER_MIN: '100000',
  });
  for (let i = 0; i < WORKERS; i++) {
    start('workers/dist/main.js', {
      WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
      WORKER_POLL_MS: '500',
    });
  }
  for (
    let i = 0;
    i < 100 &&
    !(await fetch(`${base}/api/v1/health`).then(
      (r) => r.ok,
      () => false
    ));
    i++
  ) {
    await sleep(100);
  }
  for (let i = 0; i < 100 && (log.match(/\[worker\] started/g) ?? []).length < WORKERS; i++) {
    await sleep(100);
  }

  try {
    const t0 = Date.now();
    const accepted: number[] = [];
    const ids: string[] = [];
    let errors = 0;
    await Promise.all(
      users.map(async (u) => {
        const s = Date.now();
        const res = await fetch(`${base}/api/v1/submissions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${sign({ sub: u.id })}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ problemId: 'two-sum', code: TWO_SUM }),
        }).catch(() => null);
        accepted.push(Date.now() - s);
        if (res?.status === 202) {
          ids.push(((await res.json()) as { submissionId: string }).submissionId);
        } else errors++;
      })
    );

    const done = async () =>
      (
        await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM submissions WHERE id = ANY($1::uuid[]) AND status IN ('judged', 'failed')`,
          [ids]
        )
      ).rows[0].n;
    for (const end = Date.now() + 10 * 60_000; (await done()) < ids.length && Date.now() < end;) {
      await sleep(250);
    }
    const wall = (Date.now() - t0) / 1000;

    const { rows } = await pool.query<{ ms: number; status: string; passed: boolean }>(
      `SELECT EXTRACT(EPOCH FROM (judged_at - created_at)) * 1000 AS ms, status,
              status = 'judged' AND total > 0 AND passed = total AS passed
       FROM submissions WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const e2e = rows.filter((r) => r.status === 'judged').map((r) => Number(r.ms));
    errors += rows.filter((r) => !r.passed).length + (ids.length - rows.length);

    const r = (x: number) => Math.round(x);
    const result = {
      label: process.env.LOAD_LABEL ?? 'run',
      n: N,
      workers: WORKERS,
      concurrency: process.env.WORKER_CONCURRENCY ?? 'default',
      accepted: { p50: r(pct(accepted, 50)), p95: r(pct(accepted, 95)), p99: r(pct(accepted, 99)) },
      endToEnd: { p50: r(pct(e2e, 50)), p95: r(pct(e2e, 95)), p99: r(pct(e2e, 99)) },
      throughputPerS: Number((e2e.length / wall).toFixed(2)),
      wallS: Number(wall.toFixed(1)),
      errorRate: Number((errors / N).toFixed(3)),
    };
    console.log(JSON.stringify(result));
    console.log(
      `| ${result.label} | ${result.accepted.p50} / ${result.accepted.p95} / ${result.accepted.p99} | ` +
        `${result.endToEnd.p50} / ${result.endToEnd.p95} / ${result.endToEnd.p99} | ${result.throughputPerS} | ${(result.errorRate * 100).toFixed(1)}% |`
    );
  } finally {
    for (const p of procs) p.kill('SIGTERM');
    await Promise.all(
      procs.map((p) => (p.exitCode === null ? new Promise((res) => p.once('exit', res)) : null))
    );
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users.map((u) => u.id)]); // cascades
    await closePool();
  }
}

main().catch((err) => {
  console.error('[load] failed:', err);
  process.exit(1);
});
