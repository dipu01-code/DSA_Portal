# Change Requests

Log any proposed change to an agreed endpoint, table column, or WebSocket event here before editing. Format:

## CR-001
- **Proposed by:** Person 1
- **Field:** /api/v1/problems response shape
- **Proposed change:** add `description` field
- **Reason:** frontend needs description in list view
- **Status:** pending
- **Approved by:** —

## CR-002
- **Proposed by:** Person 2
- **Field:** /docs/openapi.yaml sync section & /server/src/app.ts plugin registration
- **Proposed change:** Add OpenAPI specifications for offline-first sync endpoints:
  1. `POST /api/v1/sync/push`:
     - Request body: `{ deviceId: string, clientVersion: string, schemaVersion: integer, operations: SyncOperation[] }` (max 100 operations).
     - Response: 200 `{ success: boolean, acknowledgedOpIds: string[], duplicateOpIds: string[], serverSeqWatermark: integer, serverTimestamp: string }`.
     - Error: 400 Bad Request, 401 Unauthorized.
  2. `GET /api/v1/sync/pull`:
     - Query params: `cursor` (integer, last received `server_seq`, default 0), `limit` (integer, default 100, max 500).
     - Response: 200 `{ cursor: integer, hasMore: boolean, operations: SyncOperation[] }`.
     - Error: 410 Gone with code `SYNC_CURSOR_EXPIRED` if cursor is older than tombstone retention window (90 days).
  3. `GET /api/v1/sync/bootstrap`:
     - Full snapshot payload for device initialization or recovery from expired cursor.
     - Response: 200 `{ watermarkSeq: integer, problems: array, userSubmissions: array, userStats: array, userSettings: object, generatedAt: string }`.
  4. Register `syncRoutes` plugin from `/server/src/sync` into `server/src/app.ts`.
- **Reason:** Day 5 offline-first sync protocol implementation. Enables CLI, Desktop, and Mobile clients to synchronize local SQLite mutations with PostgreSQL.
- **Status:** pending
- **Approved by:** —
