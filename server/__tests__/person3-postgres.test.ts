/**
 * Person 3's Postgres code against a real, migrated database (skipped without one):
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest person3-postgres
 */
import './helpers/fast-bcrypt';
import { randomUUID } from 'crypto';
import type { Submission } from '@dsa-portal/core';

const DB_URL = process.env.TEST_DATABASE_URL;

(DB_URL ? describe : describe.skip)('Person 3 Postgres stores', () => {
  let pool: typeof import('../src/db/pool').pool;
  let closePool: () => Promise<void>;
  let store: import('../src/modules/auth/store').PostgresAuthStore;
  let stats: import('../src/modules/stats/stats.service').PostgresStatsStore;
  let updateStatsOnSubmission: typeof import('../src/modules/stats/stats.service').updateStatsOnSubmission;
  let problems: import('../src/db/repositories').PostgresProblemRepository;
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; // Person 2's pool reads it at import time
    ({ pool, closePool } = await import('../src/db/pool'));
    await (await import('../src/db/migrate')).migrateUp();
    store = new (await import('../src/modules/auth/store')).PostgresAuthStore();
    const s = await import('../src/modules/stats/stats.service');
    stats = new s.PostgresStatsStore();
    updateStatsOnSubmission = s.updateStatsOnSubmission;
    problems = new (await import('../src/db/repositories')).PostgresProblemRepository();
  });
  afterAll(async () => {
    if (userIds.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]); // cascades
    await pool.query(`DELETE FROM problems WHERE slug = $1`, [`p3-test-${tag}`]);
    await closePool();
  });

  const newUser = async (name: string) => {
    const u = await store.createUser({
      username: `${name}_${tag}`,
      email: `${name}_${tag}@x.io`,
      passwordHash: 'h',
    });
    userIds.push(u.id);
    return u;
  };

  it('creates and finds users, mapping duplicates to DuplicateUserError', async () => {
    const { DuplicateUserError } = await import('../src/modules/auth/store');
    const u = await newUser('pg');
    expect(u).toMatchObject({ username: `pg_${tag}`, role: 'user' });
    expect(u.createdAt).toBeInstanceOf(Date);
    expect((await store.findByEmail(`pg_${tag}@x.io`))?.passwordHash).toBe('h');
    expect(await store.findById(u.id)).toEqual(u);
    await expect(
      store.createUser({ username: `pg_${tag}`, email: 'other@x.io', passwordHash: 'h' })
    ).rejects.toBeInstanceOf(DuplicateUserError);
  });

  it('consumes a refresh token once, even concurrently; reuse revokes only its family (CR-014)', async () => {
    const u = await newUser('sess');
    const future = new Date(Date.now() + 60_000);
    await store.createSession({
      userId: u.id,
      tokenHash: `a-${tag}`,
      expiresAt: future,
      ip: '127.0.0.1',
    });
    await store.createSession({ userId: u.id, tokenHash: `other-${tag}`, expiresAt: future }); // another device
    const results = await Promise.all([
      store.consumeSession(`a-${tag}`),
      store.consumeSession(`a-${tag}`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['ok', 'reused']);
    const ok = results.find((r) => r.status === 'ok') as { familyId: string };

    // The token issued after the rotation was in the same family, so the reuse revoked it too.
    await store.createSession({
      userId: u.id,
      tokenHash: `a2-${tag}`,
      expiresAt: future,
      familyId: ok.familyId,
    });
    expect((await store.consumeSession(`a-${tag}`)).status).toBe('reused');
    expect(await store.consumeSession(`a2-${tag}`)).toEqual({ status: 'reused', userId: u.id });
    expect((await store.consumeSession(`other-${tag}`)).status).toBe('ok');
    expect(await store.consumeSession('never-issued')).toEqual({ status: 'invalid' });
  });

  it('keeps stats counters right under concurrent submissions', async () => {
    const u = await newUser('stats');
    const sub = (passed: boolean): Submission => ({
      id: randomUUID(),
      problemId: 'two-sum',
      userId: u.id,
      code: '',
      status: 'judged',
      createdAt: new Date(),
      result: {
        problemId: 'two-sum',
        status: passed ? 'passed' : 'failed',
        perTest: [{ id: '0', passed, expected: 1, actual: 1, runtimeMs: 1 }],
      },
    });
    // 10 parallel transactions, as 10 workers judging at once.
    await Promise.all(
      [false, true, false, true, false, false, true, false, false, false].map(async (passed) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await updateStatsOnSubmission(client, sub(passed));
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      })
    );
    const row = await pool.query(
      `SELECT attempts, solved, first_solved_at FROM user_problem_stats ups JOIN problems p ON p.id = ups.problem_id
       WHERE ups.user_id = $1 AND p.slug = 'two-sum'`,
      [u.id]
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]).toMatchObject({ attempts: 10, solved: true });

    expect(await stats.getFirstSolves(u.id)).toEqual([row.rows[0].first_solved_at]);
    expect(await stats.getDifficultyStats(u.id)).toEqual([
      { difficulty: 'Easy', attempted: 1, solved: 1 },
    ]);
    expect(await stats.getTopicStats(u.id)).toEqual([{ topic: 'Arrays', attempted: 1, solved: 1 }]);
  });

  it('ProblemRepository.delete unpublishes (soft delete) and reports unknown ids (CR-015)', async () => {
    await pool.query(
      `INSERT INTO problems (slug, title, topic, difficulty, description, starter_code) VALUES ($1, 't', 'Arrays', 'Easy', 'd', 's')`,
      [`p3-test-${tag}`]
    );
    expect(await problems.delete(`p3-test-${tag}`)).toBe(true);
    expect(await problems.delete(`p3-test-${tag}`)).toBe(false); // already unpublished
    const res = await pool.query('SELECT is_published FROM problems WHERE slug = $1', [
      `p3-test-${tag}`,
    ]);
    expect(res.rows[0].is_published).toBe(false);
    expect(await problems.delete(`missing-${tag}`)).toBe(false);
  });
  // Leaderboard and daily challenge are Person 1's modules (CR-021); their own tests cover the SQL.
});
