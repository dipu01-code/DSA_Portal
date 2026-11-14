# Handover — Day 4, Person 2

## What was built

Day 4 — Offline-first sync design, distributed operation log schema, PostgreSQL & SQLite sync table migrations, Hybrid Logical Clock (HLC) engine, and the sync integration contract for Person 1 and Person 3.

All work committed to branch `person-2/day-4`.

---

## 1. Sync Design Specification (`/docs/db/sync-design.md`)

Authored a comprehensive architectural document covering:

1. **Sync Scope**:
   - Bi-directional sync: `submissions` (append-only), `user_problem_stats` (recomputed authoritatively from submissions), `user_settings` (Last-Write-Wins via HLC), `sync_tombstones` (soft deletion markers).
   - Read-only downstream pull: `problems`, `test_cases`, `hints`, `solutions`, `daily_challenges`. Clients execute test suites locally offline and pull updates centrally.
2. **Operation Log Schema**:
   `op_id` (UUID), `device_id`, `user_id`, `entity`, `operation_type`, `payload` (JSONB/TEXT), `client_timestamp`, `hybrid_logical_clock`, `schema_version`, and PostgreSQL-assigned `server_seq`.
3. **Idempotency & Deduplication**:
   Guaranteed by `UNIQUE(op_id)` on `sync_op_log`. Duplicate pushes are safe and side-effect free.
4. **Batch Push & Keyset Cursor Pull**:
   Atomic push batches ($\le 50$ ops) and linear cursor pulls using monotonically increasing `server_seq`.
5. **Conflict Rules & Clocks**:
   Append-only immutable submissions, derived stats recomputation, LWW settings via HLC (`l.c.d`), clock skew clamping (max 15 min drift), 90-day tombstone TTL, and schema version tagging.
6. **Failure Mode Mitigations**:
   Atomic batch transactions for partial drops, bootstrap snapshot recovery for long-offline clients (HTTP 410 `SYNC_CURSOR_EXPIRED`), and device clone detection via non-monotonic HLC violations.
7. **Mermaid Sequence Diagrams**:
   Detailed visual flows for Push Sync, Cursor Pull Sync, Bootstrap Re-sync, and Conflict Resolution.

---

## 2. PostgreSQL Migrations (`002_sync_tables.up.sql` / `002_sync_tables.down.sql`)

Created and committed forward and rollback migrations:

- **`sync_op_log`**: Append-only log with `server_seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `op_id UUID UNIQUE`, indexes on `(server_seq ASC)` for cursor pull, `(user_id, server_seq ASC)` for user partition, and `(device_id, created_at DESC)`.
- **`sync_devices`**: Tracks user client devices, client versions, `last_seen_hlc` for clone detection, and `last_synced_seq` watermark.
- **`user_settings`**: Stores user UI preferences and editor config with `version_hlc` for LWW resolution and automated `updated_at` trigger.
- **`sync_tombstones`**: Tracks soft deletions with 90-day retention index to prevent resurrection bugs across partitioned clients.

---

## 3. SQLite Sync Schema & Core Types (`@dsa-portal/core`)

- **`core/src/storage/sqlite-schema.ts`**:
  Updated SQLite DDL to create:
  - `local_op_log`: Local pending mutation queue with `status` (`pending`, `syncing`, `synced`, `failed`), `retry_count`, and `client_timestamp`.
  - `sync_state`: Key-value storage for `last_synced_server_seq`, `device_id`, `current_hlc`, and pull timestamps.
  - `user_settings`: Local settings table with HLC versioning.
  - `local_tombstones`: Local deletion records.
  - Performance indexes on `(status, created_at ASC)` and `(entity, user_id)`.
- **`core/src/storage/sqlite-sync-migration.ts`**:
  Dedicated `migrateSqliteSync(adapter)` runner for existing local database files.
- **`core/src/sync/types.ts`**:
  Strict TypeScript interfaces: `SyncOperation`, `HybridLogicalClock`, `SyncPushRequest`, `SyncPushResponse`, `SyncPullRequest`, `SyncPullResponse`, `SyncBootstrapResponse`.
- **`core/src/sync/hlc.ts`**:
  Production HLC engine implementing `generateNextHlc`, `receiveHlc`, `compareHlc`, `parseHlc`, and `formatHlc`.

---

## 4. Sync Contract for Person 1 (Backend & System Architecture)

Person 1 will implement the Fastify REST endpoints in `/server/src/modules/sync/` (or update `/docs/openapi.yaml`).

### Endpoint 1: `POST /api/v1/sync/push`

- **Purpose**: Ingest client batch of offline mutations.
- **Authentication**: Bearer JWT (`req.user.id`).
- **Request Body**:
  ```json
  {
    "deviceId": "c2b64d00-4b4f-4d98-8c1d-000000000001",
    "clientVersion": "1.0.0",
    "schemaVersion": 1,
    "operations": [
      {
        "opId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "entity": "submission",
        "operationType": "INSERT",
        "payload": {
          "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          "problemSlug": "two-sum",
          "code": "function solve(input) { ... }",
          "status": "judged",
          "passed": 5,
          "total": 5,
          "results": [...]
        },
        "clientTimestamp": "2026-11-12T16:00:00.000Z",
        "hlc": "0001731427200.00001.c2b64d00"
      }
    ]
  }
  ```
- **Execution Logic**:
  1. Verify `operations.length <= 100` (reject with HTTP 413 if exceeded).
  2. Inside a PostgreSQL transaction (`withTransaction`):
     - Check device clock skew: if `clientTimestamp > now() + 15 minutes`, clamp physical time.
     - Upsert device in `sync_devices` (`ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen_hlc = EXCLUDED.last_seen_hlc, updated_at = now()`).
     - Insert into `sync_op_log`:
       ```sql
       INSERT INTO sync_op_log (op_id, device_id, user_id, entity, operation_type, payload, client_timestamp, hybrid_logical_clock, schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (op_id) DO NOTHING
       RETURNING server_seq, op_id;
       ```
     - Apply entity mutations:
       - If `submission`: insert into `submissions` and recompute `user_problem_stats`.
       - If `settings`: update `user_settings` only if incoming `hlc > existing.version_hlc` (LWW).
       - If `tombstone`: insert into `sync_tombstones`.
  3. Return HTTP 200:
     ```json
     {
       "success": true,
       "acknowledgedOpIds": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
       "duplicateOpIds": [],
       "serverSeqWatermark": 1050,
       "serverTimestamp": "2026-11-12T16:00:01.000Z"
     }
     ```

### Endpoint 2: `GET /api/v1/sync/pull`

- **Query Parameters**:
  - `cursor`: integer (last received `server_seq`, default `0`).
  - `limit`: integer (default `100`, max `500`).
- **Execution Logic**:
  1. Check if `cursor < min_retained_tombstone_seq`. If expired, return HTTP 410 Gone:
     ```json
     {
       "error": "SYNC_CURSOR_EXPIRED",
       "message": "Local cursor is older than tombstone retention window. Full bootstrap required."
     }
     ```
  2. Query `sync_op_log`:
     ```sql
     SELECT server_seq, op_id, device_id, user_id, entity, operation_type, payload, client_timestamp, hybrid_logical_clock, schema_version
     FROM sync_op_log
     WHERE server_seq > $1 AND (user_id = $2 OR entity = 'problem')
     ORDER BY server_seq ASC
     LIMIT $3;
     ```
  3. Return HTTP 200:
     ```json
     {
       "cursor": 1050,
       "hasMore": false,
       "operations": [...]
     }
     ```

### Endpoint 3: `GET /api/v1/sync/bootstrap`

- **Purpose**: Full state hydration for new device installations or recovery from expired cursors.
- **Returns**: Latest snapshot of problems, user submissions, aggregated stats, settings, and the current `watermarkSeq` from `MAX(server_seq)`.

---

## 5. Sync Contract for Person 3 (Client Behaviour across CLI, Web, Desktop, Mobile)

Person 3 will wire the client UI and local offline databases to the sync engine.

### 1. Generating Operations Offline

Whenever the user writes code, runs tests, or updates settings:

- Update the local domain table in SQLite (`submissions`, `user_problem_stats`, `user_settings`).
- Advance the local Hybrid Logical Clock:
  ```typescript
  import { generateNextHlc, formatHlc } from '@dsa-portal/core';
  const nextHlc = generateNextHlc(currentHlc, deviceId);
  const hlcString = formatHlc(nextHlc);
  ```
- Insert an entry into `local_op_log` with `status = 'pending'`.

### 2. Sync Worker Loop (Background / Auto-Sync)

- **Triggers**:
  - App launch / window focus.
  - Network status transition (`offline` $\rightarrow$ `online`).
  - Debounced (3 seconds) after local mutations.
- **Push Phase**:
  1. Read up to 50 entries from `local_op_log WHERE status = 'pending' ORDER BY created_at ASC`.
  2. Mark them `status = 'syncing'`.
  3. POST to `/api/v1/sync/push`.
  4. On 200 OK: Mark `status = 'synced'` and record `synced_at = datetime('now')` (or delete row from `local_op_log`).
  5. On Network Error: Revert `status = 'pending'`, increment `retry_count`, and schedule retry with exponential backoff + jitter (1s, 2s, 4s, 8s, max 30s).
- **Pull Phase**:
  1. Read `last_synced_server_seq` from `sync_state` (default `0`).
  2. GET `/api/v1/sync/pull?cursor={last_seq}&limit=100`.
  3. If HTTP 410 (`SYNC_CURSOR_EXPIRED`), call `/api/v1/sync/bootstrap` to re-hydrate SQLite.
  4. Inside an SQLite transaction, replay incoming operations:
     - **Echo Suppression**: If `op.deviceId === localDeviceId`, skip applying it to local domain tables (it originated here).
     - Update local domain tables with remote changes.
     - Call `receiveHlc(currentHlc, parseHlc(op.hlc), deviceId)` to ensure local clock accounts for remote causality.
  5. Update `sync_state` with new `last_synced_server_seq = response.cursor`.
  6. If `response.hasMore === true`, immediately pull next page.

---

## 6. How to Run & Verify

```bash
# 1. Apply PostgreSQL migration 002 (sync tables)
npm run db:migrate

# 2. Verify rollback (down migration) works cleanly
npm run db:migrate:down

# 3. Re-apply forward migrations
npm run db:migrate

# 4. In SQLite clients or tests:
# Initialize or upgrade local SQLite schema with sync tables
import { BetterSqlite3Adapter, initSqliteSchema, migrateSqliteSync } from '@dsa-portal/core';
const adapter = new BetterSqlite3Adapter({ filename: ':memory:' });
await initSqliteSchema(adapter);
```

---

## 7. Viva Defense Rationale (Design Decisions & Trade-offs)

1. **Operation Log vs. Two-Way State Diffing**:
   State diffing requires comparing every column across every row and easily falls victim to phantom updates or clock race conditions. An append-only operation log treats every change as an explicit, immutable event, ensuring that offline actions are never lost and can be deterministically replayed.
2. **Hybrid Logical Clocks (HLC) vs. Physical NTP Timestamps**:
   Physical wall clocks on user laptops and phones cannot be trusted due to clock drift, manual time adjustments, or battery resets. Pure Lamport logical clocks lose real-world time correlation. HLC strikes the optimal balance: it strictly guarantees monotonic causal ordering ($e \rightarrow f \implies HLC(e) < HLC(f)$) while remaining tightly bound to physical time.
3. **Append-Only Submissions & Derived Stats**:
   Submissions are historical records that should never collide. By treating submissions as immutable events and deriving user statistics (attempt counts, solved status, streak) authoritatively on the server, we eliminate complex distributed counter merging while guaranteeing 100% mathematical consistency.
4. **Monotonically Increasing `server_seq` Cursor**:
   Assigning `server_seq` exclusively in PostgreSQL ensures a single global linear ordering for downstream replication. Clients pull with `WHERE server_seq > :cursor`, making incremental replication lightweight, index-accelerated ($O(\log N)$ B-tree lookup), and completely immune to client-side clock skew.
