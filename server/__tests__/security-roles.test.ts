import { Pool } from 'pg';

describe('Database Security Roles & Audit Immutability', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsa_portal',
    });
  });

  afterAll(async () => {
    await pool.end();
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
    await expect(
      pool.query(`DELETE FROM audit_log WHERE id = $1`, [logId])
    ).rejects.toThrow(/audit_log is append-only/);
  });
});
