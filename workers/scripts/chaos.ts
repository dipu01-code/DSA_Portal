/**
 * Day 6 chaos test: SIGKILL a worker in the middle of a job and prove the job is still
 * processed exactly once from the user's point of view.
 *
 *   npm run build && DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npm run chaos -w workers
 *
 * Uses (and cleans up) its own user. Exit code 0 = pass.
 */
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

const DB_URL = process.env.DATABASE_URL;
const ROOT = path.join(__dirname, '../..');
const USER_ID = '00000000-0000-0000-0000-00000000c4a0';
const LEASE_MS = 2000;
const METRICS_PORT = Number(process.env.CHAOS_METRICS_PORT) || 9465;
// Correct, but busy-waits 400 ms per test (≈2 s for 5 tests), so there is time to kill the worker mid-job.
const SLOW_TWO_SUM =
  'function solve({ nums, target }) { const end = Date.now() + 400; while (Date.now() < end) {} const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (msg: string) => console.log(`[chaos] ${msg}`);

function startWorker(name: string, metricsPort?: number) {
  let log = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'workers/dist/main.js')], {
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: DB_URL,
      WORKER_CONCURRENCY: '1',
      WORKER_POLL_MS: '200',
      WORKER_LEASE_MS: String(LEASE_MS),
      ...(metricsPort ? { WORKER_METRICS_PORT: String(metricsPort) } : {}),
    },
  });
  child.stdout!.on('data', (d) => (log += d));
  child.stderr!.on('data', (d) => (log += d));
  return { name, child, log: () => log };
}

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  timeoutMs: number
): Promise<T> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(50)) {
    const v = await fn();
    if (v !== undefined) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  if (!DB_URL) throw new Error('Set DATABASE_URL to a migratable test database');
  // Person 2's pool reads DATABASE_URL at import time, so import after the check.
  const { pool, closePool } = await import('../../server/src/db/pool');
  const { migrateUp } = await import('../../server/src/db/migrate');
  const repos = await import('../../server/src/db/repositories');
  const { buildApp } = await import('../../server/src/app');
  const { PostgresSubmissionQueue } = await import('../../server/src/modules/submissions/queue');
  // The seeded two-sum (5 tests), as in a real database; core's bundled copy has only 3.
  const { SEED_PROBLEMS: PROBLEMS } = await import('../../server/src/db/seeds/problems-data');

  const workers: ChildProcess[] = [];
  let app: ReturnType<typeof buildApp> | undefined;
  try {
    await migrateUp();
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID]);
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash) VALUES ($1, 'chaos_user', 'chaos@test.dev', 'x')`,
      [USER_ID]
    );
    const problems = new repos.PostgresProblemRepository();
    if (!(await problems.findById('two-sum'))) {
      await problems.save(PROBLEMS.find((p) => p.id === 'two-sum')!);
    }

    app = buildApp({
      logger: false,
      problems,
      submissions: new repos.PostgresSubmissionRepository(),
      queue: new PostgresSubmissionQueue(),
      leaderboard: new (
        await import('../../server/src/modules/leaderboard/store')
      ).PostgresLeaderboardStore(),
      quota: { perMinute: 1e6, perDay: 1e6 },
      rateLimit: { perIp: 1e6, perUser: 1e6 },
    }); // tests the queue, not the Day 8 limits
    await app.ready();
    const auth = { authorization: `Bearer ${app.jwt.sign({ sub: USER_ID })}` };

    const a = startWorker('A');
    workers.push(a.child);
    await waitFor(
      'worker A to start',
      async () => (a.log().includes('started') ? true : undefined),
      10000
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: auth,
      payload: { problemId: 'two-sum', code: SLOW_TWO_SUM },
    });
    if (res.statusCode !== 202) throw new Error(`submit failed: ${res.statusCode} ${res.body}`);
    const id: string = res.json().submissionId;
    say(`submitted ${id}`);

    const status = async () =>
      (await app!.inject({ url: `/api/v1/submissions/${id}`, headers: auth })).json();
    await waitFor(
      'worker A to claim the job',
      async () => ((await status()).status === 'running' ? true : undefined),
      10000
    );
    a.child.kill('SIGKILL');
    say('worker A claimed the job and was killed with SIGKILL');
    await new Promise((r) => a.child.once('exit', r));

    const mid = await status();
    if (mid.status !== 'running') {
      throw new Error(`expected the job to be stuck in running, got ${mid.status}`);
    }

    const b = startWorker('B', METRICS_PORT);
    workers.push(b.child);
    say(`worker B started; the job is re-claimed once A's ${LEASE_MS} ms lease runs out`);
    const done = await waitFor(
      'the job to be judged',
      async () => {
        const s = await status();
        return s.status === 'judged' || s.status === 'failed' ? s : undefined;
      },
      30000
    );

    const db = (
      await pool.query<{ attempts: number; stats: number }>(
        `SELECT s.attempts,
                (SELECT COALESCE(SUM(attempts), 0)::int FROM user_problem_stats WHERE user_id = $2) AS stats
         FROM submissions s WHERE s.id = $1`,
        [id, USER_ID]
      )
    ).rows[0];
    const metrics = await (await fetch(`http://localhost:${METRICS_PORT}/metrics`)).text();

    const checks: [string, boolean][] = [
      [
        'the user sees one finished, correct result',
        done.status === 'judged' && done.total > 0 && done.passed === done.total,
      ],
      [
        'worker B (not A) produced it',
        b.log().includes(id) && !a.log().includes(`${id} attempt=1 judged`),
      ],
      ['the job was claimed twice (A died, B finished)', db.attempts === 2],
      ['user stats counted the attempt exactly once', db.stats === 1],
      ['metrics: B judged 1 job', /dsa_queue_jobs_total\{outcome="judged"\} 1\b/.test(metrics)],
      [
        'metrics: duration histogram has 1 sample',
        /dsa_queue_job_duration_seconds_count 1\b/.test(metrics),
      ],
      ['metrics: nothing left active', /dsa_queue_active 0\b/.test(metrics)],
    ];
    for (const [label, ok] of checks) say(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (checks.some(([, ok]) => !ok)) {
      say(`worker A log:\n${a.log()}\nworker B log:\n${b.log()}\nmetrics:\n${metrics}`);
      throw new Error('chaos test failed');
    }
    say('PASSED: killed mid-job, processed again, exactly once for the user');
  } finally {
    for (const w of workers) if (w.exitCode === null) w.kill('SIGKILL');
    await pool.query('DELETE FROM users WHERE id = $1', [USER_ID]).catch(() => {}); // cascades
    await app?.close();
    await closePool();
  }
}

main().catch((err) => {
  console.error(`[chaos] ${err.message ?? err}`);
  process.exit(1);
});
