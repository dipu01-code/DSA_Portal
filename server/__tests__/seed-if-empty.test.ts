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

  describe('secureDemoAccounts in production', () => {
    const ADMIN = '00000000-0000-0000-0000-000000000001';
    const DEV_HASH = '$2a$10$iBVruH6tb4eMv2wF.RPFT.XkkhjjPIQ/wpSU2mR.2VuHIDY8E1T2y'; // password123
    const env = {
      NODE_ENV: process.env.NODE_ENV,
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
    };
    let saved: { password_hash: string } | undefined;
    const adminHash = async () =>
      (await pool.query('SELECT password_hash FROM users WHERE id = $1', [ADMIN])).rows[0]
        .password_hash as string;

    beforeAll(async () => {
      saved = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [ADMIN])).rows[0];
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash, role) VALUES ($1, 'admin', 'admin@dsa.portal', $2, 'admin')
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [ADMIN, DEV_HASH]
      );
      process.env.NODE_ENV = 'production';
    });

    afterAll(async () => {
      Object.assign(process.env, env);
      if (env.SEED_ADMIN_PASSWORD === undefined) delete process.env.SEED_ADMIN_PASSWORD;
      if (saved) {
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
          saved.password_hash,
          ADMIN,
        ]);
      } else {
        await pool.query('DELETE FROM users WHERE id = $1', [ADMIN]);
      }
    });

    it('moves the admin off the public password onto SEED_ADMIN_PASSWORD', async () => {
      const bcrypt = (await import('bcryptjs')).default;
      const { secureDemoAccounts } = await import('../src/db/seed');
      process.env.SEED_ADMIN_PASSWORD = 'demo-only-s3cret';
      expect(await secureDemoAccounts()).toBeGreaterThanOrEqual(1);
      expect(bcrypt.compareSync('demo-only-s3cret', await adminHash())).toBe(true);
      expect(bcrypt.compareSync('password123', await adminHash())).toBe(false);
      expect(await secureDemoAccounts()).toBe(0); // already on it: no rewrite on every start
    });

    it('locks the admin when no SEED_ADMIN_PASSWORD is set', async () => {
      const bcrypt = (await import('bcryptjs')).default;
      const { secureDemoAccounts } = await import('../src/db/seed');
      delete process.env.SEED_ADMIN_PASSWORD;
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [DEV_HASH, ADMIN]);
      await secureDemoAccounts();
      expect(await adminHash()).not.toBe(DEV_HASH);
      expect(bcrypt.compareSync('password123', await adminHash())).toBe(false);
    });
  });
});
