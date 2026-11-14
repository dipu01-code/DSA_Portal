/**
 * Person 2's sync, health and metrics routes, mounted by buildApp({ postgresRoutes: true }),
 * against a real, migrated database (TEST_DATABASE_URL, never the dev one).
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';

const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/dsa_portal_test';

describe('sync, health and metrics routes on PostgreSQL', () => {
  let pool: Pool;
  let closePool: () => Promise<void>;
  let app: FastifyInstance;
  const tag = randomUUID().slice(0, 8);
  const slug = `sync-${tag}`;
  let alice: string;
  let bob: string;

  const op = (payload: object, entity = 'submission') => ({
    opId: randomUUID(),
    deviceId: 'cli-1',
    userId: 'ignored-server-uses-token',
    entity,
    operationType: 'UPSERT',
    payload,
    clientTimestamp: new Date().toISOString(),
    hlc: `${Date.now()}.0.cli-1`,
    schemaVersion: 1,
  });
  const push = (userId: string, operations: object[]) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: userId })}` },
      payload: { deviceId: 'cli-1', clientVersion: '1.0.0', schemaVersion: 1, operations },
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; // the shared pool reads it at import time
    ({ pool, closePool } = await import('../src/db/pool'));
    await (await import('../src/db/migrate')).migrateUp();
    const users = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x'), ($3, $4, 'x') RETURNING id`,
      [`a${tag}`, `a${tag}@test.dev`, `b${tag}`, `b${tag}@test.dev`]
    );
    [alice, bob] = users.rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO problems (slug, title, topic, difficulty, description, starter_code) VALUES ($1, 't', 'Arrays', 'Easy', 'd', 's')`,
      [slug]
    );
    app = (await import('../src/app')).buildApp({
      logger: false,
      postgresRoutes: true,
      rateLimit: { perIp: 1e6, perUser: 1e6 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[alice, bob]]);
    await pool.query('DELETE FROM problems WHERE slug = $1', [slug]);
    await closePool();
  });

  it('needs a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync/pull' });
    expect(res.statusCode).toBe(401);
  });

  it('push stores a submission and its stats once (idempotent by opId), pull returns it', async () => {
    const id = randomUUID();
    const o = op({ id, problemSlug: slug, code: 'x', status: 'judged', passed: 2, total: 2 });
    const first = await push(alice, [o]);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      success: true,
      acknowledgedOpIds: [o.opId],
      duplicateOpIds: [],
    });
    expect((await push(alice, [o])).json().duplicateOpIds).toEqual([o.opId]);

    const stats = await pool.query(
      `SELECT attempts, solved FROM user_problem_stats ups JOIN problems p ON p.id = ups.problem_id WHERE ups.user_id = $1 AND p.slug = $2`,
      [alice, slug]
    );
    expect(stats.rows).toEqual([{ attempts: 1, solved: true }]);

    const pull = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?cursor=0',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: alice })}` },
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json().operations.map((x: { opId: string }) => x.opId)).toContain(o.opId);
  });

  it("can't overwrite another user's submission", async () => {
    const id = randomUUID();
    await push(alice, [
      op({ id, problemSlug: slug, code: 'mine', status: 'judged', passed: 0, total: 2 }),
    ]);
    await push(bob, [
      op({ id, problemSlug: slug, code: 'x', status: 'judged', passed: 2, total: 2 }),
    ]);
    const row = await pool.query('SELECT user_id, passed FROM submissions WHERE id = $1', [id]);
    expect(row.rows).toEqual([{ user_id: alice, passed: 0 }]);
  });

  it('bootstrap returns a snapshot for the signed-in user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/bootstrap',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: alice })}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().userSubmissions.length).toBeGreaterThan(0);
  });

  it('serves the container probes and Prometheus metrics at the root', async () => {
    for (const url of ['/health', '/health/live', '/health/ready']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
  });
});
