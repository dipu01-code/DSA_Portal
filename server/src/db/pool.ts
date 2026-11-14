import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsa_portal';

/**
 * Tuned PostgreSQL Connection Pool:
 * Sized according to PostgreSQL formula: connections = ((core_count * 2) + effective_spindle_count)
 * Defaulting to 20 max connections with 4 warm min connections, 5s query timeouts, and 30s idle reaper.
 */
export const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 20),
  min: Number(process.env.DB_POOL_MIN || 4),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 5000),
  statement_timeout: 5000,
});

pool.on('error', (err: Error) => {
  console.error('[DB] Unexpected error on idle client', err);
});

/**
 * Returns live connection pool metrics for observability and health endpoints.
 */
export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * Execute a query with parameters using the connection pool
 */
export async function query<R extends QueryResultRow = any, I extends any[] = any[]>(
  text: string,
  params?: I
): Promise<QueryResult<R>> {
  const start = Date.now();
  try {
    const res = await pool.query<R>(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      console.warn(`[DB] Slow query (${duration}ms):`, text);
    }
    return res;
  } catch (error) {
    console.error('[DB] Query execution failed:', { text, error });
    throw error;
  }
}

/**
 * Acquire a dedicated client for multi-statement transactions
 */
export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

/**
 * Helper to run a callback inside a transaction block
 */
export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Checks connectivity to the database
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: unknown) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Closes the pool during application shutdown
 */
export async function closePool(): Promise<void> {
  await pool.end();
}

export type PoolMetrics = ReturnType<typeof getPoolMetrics>;

/** The shared pool, for services that take an injectable Pool (health checks). */
export function getPool(): Pool {
  return pool;
}
