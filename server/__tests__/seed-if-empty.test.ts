/**
 * seedIfEmpty runs on every start where there is no shell to seed by hand (Render free plan):
 * it must leave a database that already has problems untouched. (The empty path is the normal seed.)
 */
import type { Pool } from 'pg';

const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/dsa_portal_test';

describe('seedIfEmpty', () => {
  let pool: Pool;
  let closePool: () => Promise<void>;
  const slug = `seed-guard-${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; // the shared pool reads it at import time
    ({ pool, closePool } = await import('../src/db/pool'));
    await (await import('../src/db/migrate')).migrateUp();
    await pool.query(
      `INSERT INTO problems (slug, title, topic, difficulty, description, starter_code) VALUES ($1, 't', 'Arrays', 'Easy', 'd', 's')`,
      [slug]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM problems WHERE slug = $1', [slug]);
    await closePool();
  });

  it('skips when problems already exist', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM problems');
    const { seedIfEmpty } = await import('../src/db/seed');
    expect(await seedIfEmpty()).toBeNull();
    const after = await pool.query('SELECT count(*)::int AS n FROM problems');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
