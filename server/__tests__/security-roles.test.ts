import type { Pool } from 'pg';

// Separate test database, never the dev one (it inserts audit rows that can't be deleted).
const DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres@localhost:5432/dsa_portal_test';

describe('Database Security Roles & Audit Immutability', () => {
  let pool: Pool;
  let closePool: () => Promise<void>;

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL; // the shared pool reads it at import time
    ({ pool, closePool } = await import('../src/db/pool'));
    await (await import('../src/db/migrate')).migrateUp();
  });

  afterAll(async () => {
    await closePool();
  });

  it('verifies least-privilege roles exist in PostgreSQL', async () => {
    const res = await pool.query(`
      SELECT rolname FROM pg_roles WHERE rolname IN ('dsa_app', 'dsa_worker', 'dsa_readonly')
    `);
    const foundRoles = res.rows.map((r) => r.rolname);
    expect(foundRoles).toContain('dsa_app');
    expect(foundRoles).toContain('dsa_worker');
    expect(foundRoles).toContain('dsa_readonly');
  });

  it('blocks UPDATE operations on audit_log table', async () => {
    // Insert an audit log record
    const insertRes = await pool.query(`
      INSERT INTO audit_log (action, entity_type, entity_id, new_value)
      VALUES ('TEST_ACTION', 'User', '00000000-0000-0000-0000-000000000001', '{"test": true}')
      RETURNING id
    `);
    const logId = insertRes.rows[0].id;

    // Attempting to UPDATE must throw a security exception
    await expect(
      pool.query(`UPDATE audit_log SET action = 'TAMPERED' WHERE id = $1`, [logId])
    ).rejects.toThrow(/audit_log is append-only/);
  });

  it('blocks DELETE operations on audit_log table', async () => {
    const insertRes = await pool.query(`
      INSERT INTO audit_log (action, entity_type, entity_id, new_value)
      VALUES ('TEST_DELETE', 'User', '00000000-0000-0000-0000-000000000002', '{"test": true}')
      RETURNING id
    `);
    const logId = insertRes.rows[0].id;

    // Attempting to DELETE must throw a security exception
    await expect(pool.query(`DELETE FROM audit_log WHERE id = $1`, [logId])).rejects.toThrow(
      /audit_log is append-only/
    );
  });

  it('lets a user be deleted: ON DELETE SET NULL may clear actor_id, nothing else (migration 007)', async () => {
    const tag = `sr${Date.now() % 1e9}`;
    const users = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x'), ($3, $4, 'x') RETURNING id`,
      [`${tag}a`, `${tag}a@test.dev`, `${tag}b`, `${tag}b@test.dev`]
    );
    const [a, b] = users.rows.map((r) => r.id);
    const log = await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type) VALUES ($1, 'TEST_ACTOR', 'User') RETURNING id`,
      [a]
    );
    const logId = log.rows[0].id;

    // Re-attributing a row to someone else is still tampering.
    await expect(
      pool.query(`UPDATE audit_log SET actor_id = $1 WHERE id = $2`, [b, logId])
    ).rejects.toThrow(/audit_log is append-only/);

    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[a, b]]);
    const after = await pool.query(`SELECT actor_id, action FROM audit_log WHERE id = $1`, [logId]);
    expect(after.rows[0]).toEqual({ actor_id: null, action: 'TEST_ACTOR' });
  });
});
