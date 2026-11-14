/**
 * Day 9 full flow with every part as a real process: the built API (server/dist/index.js, exactly what
 * `npm run start -w server` runs), the built worker (workers/dist/main.js) and PostgreSQL. Talks to them over HTTP
 * and Socket.IO only. register → login → random problem → submit → result by polling AND by socket → stats updated.
 * Needs a database:  TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest full-flow
 */
import { execSync, spawn, type ChildProcess } from 'child_process';
import { createServer, type AddressInfo } from 'net';
import * as path from 'path';
import { io as connectSocket } from 'socket.io-client';

const DB_URL = process.env.TEST_DATABASE_URL;
const ROOT = path.join(__dirname, '../..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

(DB_URL ? describe : describe.skip)(
  'full flow (built API + built worker + PostgreSQL, over HTTP and Socket.IO)',
  () => {
    const procs: ChildProcess[] = [];
    let log = '';
    let base = '';
    let pool: typeof import('../../server/src/db/pool').pool;
    let closePool: () => Promise<void>;
    let SEED: typeof import('../../server/src/db/seeds/problems-data').SEED_PROBLEMS;
    const email = `flow_${Date.now()}@test.dev`;
    const password = 'Str0ng-pass!';

    const api = async (method: string, url: string, token?: string, body?: unknown) => {
      const res = await fetch(`${base}/api/v1${url}`, {
        method,
        headers: {
          ...(token && { authorization: `Bearer ${token}` }),
          ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        body: text ? JSON.parse(text) : undefined,
      };
    };

    const start = (script: string, env: Record<string, string>) => {
      const p = spawn(process.execPath, [path.join(ROOT, script)], {
        env: { PATH: process.env.PATH!, DATABASE_URL: DB_URL!, ...env },
      });
      p.stdout!.on('data', (d) => (log += d));
      p.stderr!.on('data', (d) => (log += d));
      procs.push(p);
    };

    beforeAll(async () => {
      process.env.DATABASE_URL = DB_URL;
      ({ pool, closePool } = await import('../../server/src/db/pool'));
      const { migrateUp } = await import('../../server/src/db/migrate');
      const { PostgresProblemRepository } = await import('../../server/src/db/repositories');
      ({ SEED_PROBLEMS: SEED } = await import('../../server/src/db/seeds/problems-data'));
      await migrateUp();
      const problems = new PostgresProblemRepository();
      for (const p of SEED) if (!(await problems.findById(p.id))) await problems.save(p);

      execSync('npm run -s build', { cwd: ROOT, stdio: 'ignore' });
      const port = await freePort();
      base = `http://127.0.0.1:${port}`;
      start('server/dist/index.js', {
        PORT: String(port),
        JWT_SECRET: 'full-flow-secret',
        BCRYPT_COST: '4',
        LOG_LEVEL: 'warn',
        SUBMIT_QUOTA_PER_MINUTE: '2', // small, so the quota test below hits it through PostgreSQL
        RATE_LIMIT_USER_PER_MIN: '10000', // polling on a slow CI box must not trip the request limit
      });
      start('workers/dist/main.js', { WORKER_CONCURRENCY: '2', WORKER_POLL_MS: '500' });
      for (let i = 0; i < 100; i++) {
        if (
          log.includes('[worker] started') &&
          (await fetch(`${base}/api/v1/health`).then(
            (r) => r.ok,
            () => false
          ))
        ) {
          break;
        }
        await sleep(100);
      }
      expect(log).toContain('[worker] started');
    }, 120_000);

    afterAll(async () => {
      for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
      await Promise.all(
        procs.map((p) => (p.exitCode === null ? new Promise((r) => p.once('exit', r)) : null))
      );
      if (pool) await pool.query('DELETE FROM users WHERE email = $1', [email]); // cascades to sessions, submissions, stats
      await closePool?.();
    });

    let token = '';
    let userId = '';

    it('register → login → random problem → submit → result by polling and by socket → stats updated', async () => {
      expect(
        (
          await api('POST', '/auth/register', undefined, {
            username: `flow${Date.now() % 1e9}`,
            email,
            password,
          })
        ).status
      ).toBe(201);
      const login = await api('POST', '/auth/login', undefined, { email, password });
      expect(login.status).toBe(200);
      token = login.body.accessToken;
      userId = (await api('GET', '/auth/me', token)).body.id;
      const before = (await api('GET', '/stats/me', token)).body;
      expect(before).toMatchObject({ attempted: 0, solved: 0 });

      const problem = (await api('GET', '/problems/random?topic=Arrays&difficulty=Easy', token))
        .body;
      expect(problem).toMatchObject({ topic: 'Arrays', difficulty: 'Easy' });
      expect((await api('GET', `/problems/${problem.id}/solution`, token)).status).toBe(403); // locked until solved

      const socket = connectSocket(base, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      const events: Array<{
        event: string;
        data: { submissionId?: string; status?: string; passed?: number; total?: number };
      }> = [];
      socket.onAny((event, data) => events.push({ event, data }));
      await new Promise<void>((resolve, reject) =>
        socket.once('connect', resolve).once('connect_error', reject)
      );

      try {
        const code = SEED.find((p) => p.id === problem.id)!.solution.code;
        const created = await api('POST', '/submissions', token, { problemId: problem.id, code });
        expect(created.status).toBe(202);
        const id = created.body.submissionId;

        // Polling (the fallback every client keeps) ...
        let result = created.body;
        for (let i = 0; i < 100 && !['judged', 'failed'].includes(result.status); i++) {
          await sleep(500);
          result = (await api('GET', `/submissions/${id}`, token)).body;
        }
        expect(result.status).toBe('judged');
        expect(result.total).toBeGreaterThan(0);
        expect(result.passed).toBe(result.total);

        // ... and the socket, with the three status events in order, for this submission.
        const mine = () => events.filter((e) => e.data?.submissionId === id);
        for (let i = 0; i < 50 && !mine().some((e) => e.event === 'submission:finished'); i++) {
          await sleep(100);
        }
        expect(mine().map((e) => e.event)).toEqual([
          'submission:queued',
          'submission:running',
          'submission:finished',
        ]);
        expect(mine()[2].data).toMatchObject({
          status: 'judged',
          passed: result.total,
          total: result.total,
        });
        expect(events.some((e) => e.event === 'leaderboard:updated')).toBe(true);

        // Stats updated (in the same transaction as the result), and the solution unlocks.
        const after = (await api('GET', '/stats/me', token)).body;
        expect(after).toMatchObject({ attempted: 1, solved: 1 });
        expect(after.topics.find((t: { topic: string }) => t.topic === 'Arrays')).toMatchObject({
          solved: 1,
        });
        expect((await api('GET', `/problems/${problem.id}/solution`, token)).body.solution).toBe(
          code
        );

        // Day 8 audit row, written through Person 2's PostgresAuditRepository.
        const audit = await pool.query(
          `SELECT actor_id, action, host(ip_address) AS ip, new_value FROM audit_log WHERE entity_type = 'submission' AND entity_id = $1`,
          [id]
        );
        expect(audit.rows).toEqual([
          {
            actor_id: userId,
            action: 'submission.create',
            ip: '127.0.0.1',
            new_value: expect.objectContaining({ problemId: problem.id, codeLength: code.length }),
          },
        ]);
      } finally {
        socket.close();
      }
    }, 60_000);

    it('enforces the per-user quota through PostgreSQL (2 per minute here) with Retry-After', async () => {
      // The first test already made one submission in this minute.
      expect(
        (
          await api('POST', '/submissions', token, {
            problemId: 'two-sum',
            code: 'function solve() { return [0, 1]; }',
          })
        ).status
      ).toBe(202);
      const res = await api('POST', '/submissions', token, {
        problemId: 'two-sum',
        code: 'function solve() { return [1, 0]; }',
      });
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('QUOTA_EXCEEDED');
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('sends the security headers from the real server', async () => {
      const res = await fetch(`${base}/api/v1/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-request-id')).toBeTruthy();
    });
  }
);
