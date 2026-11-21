# Database & Backend Application Integration (Section 2.F)

## 1. Overview of Backend-Database Architecture

The backend application is implemented in **Node.js (v20) and TypeScript** using the high-performance **Fastify** framework. It integrates directly with **PostgreSQL 16** via the native `pg` driver using connection pooling and the **Repository Pattern**.

```mermaid
flowchart LR
    Client(["HTTP Client / Frontends"]) --> Fastify["Fastify REST API (/api/v1)"]
    Fastify --> Service["Business Services<br/>(Problems, Submissions, Sync)"]
    Service --> Repo["Repository Layer<br/>(ProblemRepo, SubmissionRepo, StatsRepo)"]
    Repo --> Pool["Tuned pg.Pool (max: 20, min: 4)<br/>server/src/db/pool.ts"]
    Pool --> PG[("PostgreSQL 16 Engine<br/>dsa_portal")]
```

---

## 2. Connection Pool Design & Tuning (`server/src/db/pool.ts`)

Instead of opening a new TCP socket per HTTP request, the backend leverages a tuned PostgreSQL connection pool sized according to PostgreSQL's hardware formula:

$$\text{connections} = ((\text{CPU Cores} \times 2) + \text{Effective Spindle Count})$$

```typescript
// server/src/db/pool.ts
import { Pool, PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsa_portal',
  max: Number(process.env.DB_POOL_MAX || 20),           // Pool ceiling to protect database memory
  min: Number(process.env.DB_POOL_MIN || 4),            // Warm connections ready for immediate requests
  idleTimeoutMillis: 30000,                             // Reap idle sockets after 30 seconds
  connectionTimeoutMillis: 5000,                        // Fail fast (5s) if database is saturated
  statement_timeout: 5000,                              // Kill runaway queries after 5 seconds
});

export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,                    // Key indicator of query queueing
  };
}
```

---

## 3. Atomic Multi-Statement Transactions (`withTransaction`)

Critical business operations (such as code judging, user balance changes, or sync flushes) must commit or rollback as a single atomic unit. We implemented the `withTransaction` pattern:

```typescript
// server/src/db/pool.ts
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // Return client to pool
  }
}
```

---

## 4. SQL Injection Prevention via Parameterized Queries

The platform strictly prohibits raw string interpolation or concatenation in SQL statements. All queries use native PostgreSQL parameterized placeholders (`$1, $2, ...`):

```typescript
// Safe Parameterized Query Example in PostgresProblemRepository
async findById(id: string): Promise<Problem | null> {
  const queryText = `
    SELECT id, slug, title, topic, difficulty, description, starter_code
    FROM problems
    WHERE id = $1 AND is_published = true
  `;
  const res = await pool.query(queryText, [id]);
  return res.rows[0] ? this.mapRow(res.rows[0]) : null;
}
```

---

## 5. Repository Pattern Implementation

The backend decouples SQL statements from business routes through strongly-typed repository classes in `server/src/db/repositories/`:

### 5.1 `PostgresSubmissionRepository`
Handles submission lifecycle (CRUD operations):
- `save(submission)`: Inserts queued submission records with JSONB results.
- `findById(id)`: Fetches execution status for client polling.
- `findByUser(userId, limit, offset)`: Retrieves paginated history.

### 5.2 `PostgresStatsRepository`
Implements user progress reporting:
- `getUserStats(userId)`: Pre-aggregated score, attempted count, solved count, and streak.
- `getTopicStats(userId)`: Per-topic breakdown for analytics charts.

---

## 6. Offline-to-Online Dual-Adapter Synchronization

To support offline-first operations on Desktop (Electron) and Mobile (React Native), the core storage abstraction (`core/src/storage/adapter.ts`) implements a common interface:

```typescript
export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  close(): Promise<void>;
}
```

- When running in the **CLI or Desktop**, the app operates against `BetterSqlite3Adapter` (local SQLite with WAL mode).
- When operating on the **Server**, the app operates against `PostgresAdapter` / `pg.Pool`.
- The `SyncEngine` bridges the two, reading local SQLite operation logs and pushing batches to PostgreSQL.

---

## 7. Evidence of Database-Backend Reflection

All data modifications entered through the API routes are reflected and validated in PostgreSQL:

1. **User Registration** (`POST /api/v1/auth/register`):
   - Ingests username, email, password.
   - Hashes password with bcrypt ($10$ rounds).
   - Inserts row into `users` table; violates `chk_email_format` if malformed.
2. **Submission Creation** (`POST /api/v1/submissions`):
   - Inserts record into `submissions` (`status: 'queued'`).
   - Pushes job into Redis BullMQ queue.
3. **Worker Judging Execution**:
   - Worker evaluates code against hidden test cases.
   - Executes `UPDATE submissions SET status = 'judged', passed = $1, total = $2, results = $3 WHERE id = $4`.
   - Executes upsert on `user_problem_stats`.
   - Querying `SELECT * FROM submissions WHERE id = ...` immediately confirms updated state with execution latency under $2\text{ ms}$.
