# Handover — Day 5, Person 2

## What was built
Day 5 — Complete implementation of the offline-first synchronization engine across both server and client layers, verified with an automated convergence test suite.

All work committed to branch `person-2/day-5`.

---

## 1. Server Sync Module (`/server/src/sync`)

Implemented the central PostgreSQL sync service and Fastify routes:
- **`server/src/sync/sync.service.ts`**:
  - `push(userId, body)`: Ingests batches of up to 100 client operations inside an ACID transaction (`withTransaction`). Implements server-side clock skew guardrails (clamping future timestamps $> 15$ min), updates device registration in `sync_devices`, inserts into `sync_op_log` with `ON CONFLICT (op_id) DO NOTHING`, applies domain mutations (submissions, LWW settings, tombstones), recomputes `user_problem_stats`, and returns acknowledged and duplicate op IDs alongside the latest `serverSeqWatermark`.
  - `pull(userId, query)`: Implements keyset cursor pagination with monotonically increasing `server_seq`. Checks against tombstone retention windows (90 days) and throws `SyncCursorExpiredError` (HTTP 410) if the client cursor has expired.
  - `bootstrap(userId)`: Emits full snapshot recovery state for fresh device hydration or cursor recovery.
- **`server/src/sync/sync.controller.ts`**:
  - Fastify route plugin exposing `POST /api/v1/sync/push`, `GET /api/v1/sync/pull`, and `GET /api/v1/sync/bootstrap` guarded with JWT bearer authentication.
- **`/docs/CHANGE_REQUESTS.md` (CR-002)**:
  - Formally logged the change request for Person 1 to register `syncRoutes` into `server/src/app.ts` and merge the OpenAPI specification for sync into `docs/openapi.yaml`.

---

## 2. Client Sync Engine (`/core/src/sync`)

Written for Node.js (CLI and Electron) with a pluggable adapter architecture so React Native (Expo) can plug in `expo-sqlite`:
- **`SyncStorageAdapter` & `SqliteSyncStorageAdapter`** (`storage-adapter.ts`):
  - Manages the local SQLite queue (`local_op_log`), status transitions (`pending` $\rightarrow$ `syncing` $\rightarrow$ `synced` / `failed`), retry counters, sync state watermarks (`sync_state`), and domain mutations.
- **`SyncTransport` & `HttpSyncTransport`** (`transport.ts`):
  - Pluggable network transport abstraction decoupling sync loop execution from HTTP clients for reliable offline mocking and network swaps.
- **`ConflictResolver`** (`conflict-resolver.ts`):
  - Enforces domain conflict rules: append-only submissions, derived stats recomputation, and Last-Write-Wins (LWW) settings via Hybrid Logical Clocks (`compareHlc`).
- **`SyncEngine`** (`sync-engine.ts`):
  - Complete client sync coordinator implementing the required public API, exponential backoff with jitter on network disconnects, resumable batch chunking, echo suppression, and automatic monotonic HLC tracking.

---

## 3. Public API & Status Contract for Person 3 (Sync UI & Client Apps)

Person 3 can integrate `SyncEngine` directly into CLI, Web, Desktop, and Mobile:

```typescript
import { SyncEngine, SqliteSyncStorageAdapter, HttpSyncTransport } from '@dsa-portal/core';

const syncEngine = new SyncEngine({
  storage: new SqliteSyncStorageAdapter(dbAdapter),
  transport: new HttpSyncTransport('https://api.dsa.portal', () => getAuthToken()),
  deviceId: clientDeviceId,
  userId: currentUserId,
  intervalMs: 10000, // Periodic sync interval (10s)
  batchSize: 50,     // Max ops per batch
  backoff: { minMs: 1000, maxMs: 30000, factor: 2 }
});
```

### Methods
| Method | Signature | Description |
| :--- | :--- | :--- |
| `start()` | `(): void` | Starts background sync timer loop and triggers immediate initial sync. |
| `stop()` | `(): void` | Stops background loop and clears any scheduled retry or interval timers. |
| `syncNow()` | `(): Promise<SyncResult>` | Forces an immediate one-shot push-then-pull sync cycle. Returns counts of pushed/pulled ops. |
| `pendingCount()` | `(): Promise<number>` | Returns count of local mutations waiting to be uploaded (`pending` or `failed`). |
| `onStatus(cb)` | `(cb: (event: SyncStatusEvent) => void): () => void` | Subscribes to status and lifecycle events. Returns unsubscribe function. |
| `recordMutation()` | `(entity, opType, payload, opId?): Promise<SyncOperation>` | Records an offline mutation with monotonic HLC and persists to SQLite. |

### Status Values for Person 3's UI Component
The `SyncStatus` union represents the state machine:
- **`'idle'`**: Synced and waiting for changes. Display a green checkmark or "Synced".
- **`'syncing'`**: Currently pushing or pulling batches. Display a spinning sync icon.
- **`'error'`**: Encountered a network or server error. Engine is backing off exponentially. Display a warning icon with `event.error.message` and a "Retry Now" button calling `syncNow()`.
- **`'offline'`**: Device has no internet connection (triggered when transport reports network unreachable).

#### React Hook Example for Person 3:
```tsx
export function useSyncStatus(engine: SyncEngine) {
  const [status, setStatus] = useState<SyncStatusEvent>({
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
  });

  useEffect(() => {
    return engine.onStatus((event) => setStatus(event));
  }, [engine]);

  return {
    ...status,
    syncNow: () => engine.syncNow(),
  };
}
```

---

## 4. Test Suite (`core/__tests__/sync/sync-engine.test.ts`)

Verified against all 4 required scenarios:
1. **Two devices go offline, make changes, reconnect and converge**:
   - Device A and Device B independently record offline submissions and settings modifications.
   - Both devices reconnect and sync.
   - Submissions from both devices are preserved (append-only).
   - Problem stats converge identically on both devices (`attempts = 2`, `solved = 1`).
   - Settings converge deterministically to the winning HLC (`{ theme: 'nord', fontSize: 14 }`).
2. **Duplicate push**:
   - Replaying the exact same batch produces 200 OK with zero duplicate rows in the database.
3. **Server error halfway through a batch**:
   - Mid-batch network drops trigger atomic rollback; operations remain marked `failed` in local queue with incremented retry counters and resume cleanly on retry.
4. **Stale cursor**:
   - Expired cursors trigger `SYNC_CURSOR_EXPIRED`, leading to automatic bootstrap snapshot hydration and cursor reset.

All 40 tests across `@dsa-portal/core` are 100% green:
```bash
npx jest core/__tests__/
# Test Suites: 10 passed, 10 total
# Tests:       40 passed, 40 total
```

---

## 5. Viva Defense Rationale (Design Decisions & Trade-offs)

1. **Two-Phase Push-Then-Pull Architecture**:
   Clients always push pending local mutations before pulling remote updates. This ensures the server learns of the client's latest causal state before computing downstream deltas, preventing the client from pulling an older view of its own modified entities.
2. **Resumable Batches with Per-Operation Status**:
   Local operations transition through `pending` $\rightarrow$ `syncing` $\rightarrow$ `synced`. If a connection drops midway through uploading 50 items, failed items remain safely queued with error logging and exponential backoff, preventing data loss on unstable mobile connections.
3. **Pluggable `SyncStorageAdapter` for React Native / Expo**:
   Rather than hardcoding `better-sqlite3`, we decoupled storage through `SyncStorageAdapter`. Node CLI and Electron use high-performance WAL SQLite, while React Native plugs in `expo-sqlite` without altering a single line of sync engine logic.
4. **Self-Healing Bootstrap Fallback**:
   When an offline client wakes up after months of inactivity past the 90-day tombstone retention window, incremental cursor pulls fail safely with `SYNC_CURSOR_EXPIRED`. The client seamlessly falls back to a complete snapshot bootstrap, preventing resurrection bugs while keeping replication lightweight.
