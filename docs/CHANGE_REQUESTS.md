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

- **Proposed by:** Person 1 (Day 4)
- **Field:** `GET /api/v1/health`
- **Proposed change:** add it to openapi.yaml (`200 {status, service}`, no auth).
- **Reason:** the route has existed since Day 1 but is not in the spec; Docker/infra health checks (Person 2) need it documented. The contract test currently exempts it.
- **Status:** pending
- **Approved by:** —

## CR-003

- **Proposed by:** Person 1 (Day 4)
- **Field:** responses of `/problems`, `/problems/random`, `/problems/{id}`, `/problems/{id}/hints`, `/problems/{id}/solution`, `GET /submissions`
- **Proposed change:** document `400 BadRequest` and `401 Unauthorized` (they all require a bearer token and validate query params).
- **Reason:** the server already returns these in the standard Error format; clients should see them in the spec.
- **Status:** pending
- **Approved by:** —

## CR-004

- **Proposed by:** Person 1 (Day 4)
- **Field:** `Problem` schema used by `GET /problems/random` and `GET /problems/{id}`
- **Proposed change:** drop `solution` (and later, hidden test cases) from the `Problem` response; keep it only on `GET /problems/{id}/solution`.
- **Reason:** the spec requires `solution` in `Problem`, so the "locked until solved" solution endpoint can be bypassed by reading the problem. Day 4 follows the spec as written.
- **Status:** pending
- **Approved by:** —

## CR-005

- **Proposed by:** Person 1 (Day 5)
- **Field:** Stack — submission queue
- **Proposed change:** use the PostgreSQL `submissions` table as the job queue (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`) instead of BullMQ + Redis. The old BullMQ worker code and the `bullmq`/`ioredis` dependencies were removed from `/workers`.
- **Reason:** team decision on Day 5 to run on PostgreSQL only. One service fewer; job and result share one transactional store. Redis can still be added later for Person 3's caching and the Day 7 Socket.IO adapter.
- **Status:** implemented on Day 5, needs team sign-off
- **Approved by:** Person 1's user (Day 5 session)

## CR-006

- **Proposed by:** Person 1 (Day 5)
- **Field:** `POST /api/v1/submissions` in openapi.yaml
- **Proposed change:** document the optional `Idempotency-Key` request header (1–128 chars, unique per user) and a `409 IDEMPOTENCY_KEY_REUSED` response (same key, different body). A replayed key returns `202` with the original `submissionId` and its current status.
- **Reason:** Day 5 requirement; the server already behaves like this.
- **Status:** pending
- **Approved by:** —

## CR-007

- **Proposed by:** Person 1 (Day 5), **for Person 2** (owner of `/server/src/db`)
- **Field:** `/server/src/db` and the `submissions` table
- **Change already made (approved by Person 1's user so Day 5 could run):**
  1. Added `pg` + `@types/pg` and the `db:*` scripts to `server/package.json` (the root `npm run db:*` scripts pointed at scripts that did not exist).
  2. `migrate.ts`: `001_initial_schema.sql` and `.up.sql` share one key, so a fresh database applied 001 twice and crashed ("type already exists"). Now each key is applied once.
  3. `PostgresSubmissionRepository`: it read `result.passed/total/results`, which don't exist on core's `ExecutionResult` (`{status, perTest}`), so results were saved as 0/0. It now stores `perTest` (+ `testCaseIndex`) in `results`, rebuilds `ExecutionResult` on read, and maps `judged_at` and `idempotency_key`. Added `findByIdempotencyKey`.
  4. `pool.ts` generic typing fix; unused import removed from `seed.ts`; repository test updated to the core shape.
  5. New migration `002_submission_queue` (+ down): `idempotency_key` column with unique index per user, a partial index on queued rows, and a `pg_notify` trigger.
- **Please review:** `PostgresProblemRepository.findAll` runs 1 + 3 queries per problem (40 problems → 121 queries per list call); worth a JOIN before the Day 9 load test. Docker's init script only mounts 001, so docker users must still run `npm run db:migrate` for 002.
- **Status:** done, needs Person 2's review
- **Approved by:** —

## CR-008

- **Proposed by:** Person 1 (audit after Day 5), **for Person 2**
- **Changes already made (approved by Person 1's user):**
  1. `infra/docker-compose.yml`: removed the `docker-entrypoint-initdb.d` mount and deleted the duplicate `001_initial_schema.sql`. The init script created the schema without recording it in `_migrations`, so `npm run db:migrate` then crashed ("type user_role already exists") and never applied 002. Setup is now `npm run db:up && npm run db:migrate && npm run db:seed`. `docs/infra/docker.md` updated.
  2. `seeds/problems-data.ts`: `binary-tree-level-order-traversal` test 5 used LeetCode's tree format (`[1, null, 2, null, 3]`) while every solution uses heap order, so the reference solution failed it. Now `[1, null, 2, null, null, null, 3]`, and all five tree descriptions say the array is in heap order (children of `i` at `2i + 1` and `2i + 2`).
- **Checked:** all 40 seed reference solutions (and the 3 core ones) pass their own tests; a fresh database migrates 001 + 002 once.
- **Status:** done, needs Person 2's review
- **Approved by:** —

## CR-009

- **Proposed by:** Person 3 (Day 1), **for Person 2**
- **Field:** `UserRepository` (core) / `PostgresUserRepository`
- **Proposed change:** none required now. FYI: core's `UserRepository` has no `findByEmail`, no password hash and no sessions, so auth uses its own `AuthStore` interface in `server/src/modules/auth/store.ts` (`InMemoryAuthStore` + `PostgresAuthStore`, which reads/writes the existing `users` and `sessions` tables; columns unchanged). If you prefer all SQL under `/server/src/db`, move `PostgresAuthStore` there and I'll import it.
- **Status:** pending review
- **Approved by:** —

## CR-010

- **Proposed by:** Person 3 (Day 3), **for Person 1** (owner of `server/src/app.ts`, `server/src/index.ts`, `/workers`)
- **Field:** route wiring only, no endpoint change
- **Proposed change:** in `app.ts`:
  - `AppOptions` gets `auth?: AuthStore`, `stats?: StatsStore`, `deleteProblem?: (id: string) => Promise<boolean>`; defaults `new InMemoryAuthStore()`, `new InMemoryStatsRepository(deps.problems, deps.submissions)`, `async () => false`.
  - Swap the TEMP decorator for Person 3's: `app.decorate('authenticate', authenticate)` (from `modules/auth/hooks`; same behaviour, so nothing else changes).
  - Inside the `/api/v1` plugin: `await api.register(authRoutes, { auth: deps.auth });`, `await api.register(adminRoutes, { auth: deps.auth, problems: deps.problems, deleteProblem: deps.deleteProblem });`, `await api.register(statsRoutes, { stats: deps.stats });`.
  - In `index.ts`: `auth: new PostgresAuthStore()`, `stats: new PostgresStatsStore()`, `deleteProblem: unpublishProblem`.
  - `server/__tests__/helpers/person3-app.ts` (`buildPerson3App`) shows the exact wiring and can be deleted afterwards. Then add the auth/admin/stats routes to `openapi-contract.test.ts`.
  - `statsServiceStub` in `/workers` can stay a no-op: counters are written in the submission transaction (see CR-017).
- **Status:** pending
- **Approved by:** —

## CR-011

- **Proposed by:** Person 3 (Day 1), **for Person 2**
- **Field:** `StatsRepository.getUserStats()` return shape (core)
- **Proposed change:** return `streak: { currentStreak, longestStreak, lastSolvedAt }` (the spec's `StreakStat`) instead of `streak: number`.
- **Reason:** `GET /stats/me` must return a full `StreakStat` or nothing. Also: the streak is computed with the server's local timezone.
- **Update (Day 4):** no longer blocking. Person 3's stats module now computes the full `StreakStat` itself (UTC days) from `user_problem_stats.first_solved_at` (`PostgresStatsStore.getFirstSolves`). `getUserStats().streak` is unused by the API; Person 2 may keep or drop it.
- **Status:** superseded
- **Approved by:** —

## CR-012

- **Proposed by:** Person 3 (Day 1), **for Person 2**
- **Field:** `server/src/db/seed.ts` dev password hash
- **Proposed change:** replace `$2b$10$wO3P6P6E0.0eK3.yF8iUSeVqjYh4c9qK2M5A1hU6d2Y/F4kH6v6y.` with `$2a$10$iBVruH6tb4eMv2wF.RPFT.XkkhjjPIQ/wpSU2mR.2VuHIDY8E1T2y`.
- **Reason:** the current value is not a valid bcrypt hash of `password123` (`bcrypt.compare` returns false), so `admin@dsa.portal` / `student@dsa.portal` cannot log in.
- **Status:** pending
- **Approved by:** —

## CR-013

- **Proposed by:** Person 3 (Day 1), **for Person 1** (openapi owner)
- **Field:** `POST /api/v1/auth/refresh` and `/auth/logout`
- **Proposed change:** also accept `{ "refreshToken": "..." }` in the JSON body when there is no `refresh_token` cookie.
- **Reason:** the mobile (Expo) client has no reliable cookie jar; login already returns `refreshToken` in the body, but today it can only be sent back as a cookie. Not implemented until approved.
- **Update (Day 5):** withdrawn. Native clients (Electron main, Expo) send the stored token in a `Cookie: refresh_token=...` header and read the rotated one from `Set-Cookie` (`nativeRefresh` in `/ui-core`), which the spec already allows.
- **Status:** withdrawn
- **Approved by:** —

## CR-014

- **Proposed by:** Person 3 (Day 3), **for Person 2**
- **Field:** `sessions` table
- **Proposed change:** add `revoked_at TIMESTAMPTZ NULL` and `family_id UUID NOT NULL` (one family per login).
- **Reason:** refresh rotation with reuse detection is implemented today without a schema change: a rotated session keeps its row with `expires_at = 'epoch'`, and presenting it again revokes all of the user's sessions. That works, but (1) a cleanup job deleting expired rows also forgets rotated ones, and (2) reuse revokes _every_ device instead of only the stolen family. With the two columns, `PostgresAuthStore.consumeSession` changes in one place.
- **Status:** pending
- **Approved by:** —

## CR-015

- **Proposed by:** Person 3 (Day 3), **for Person 1** (core `ProblemRepository`) and **Person 2** (`PostgresProblemRepository`)
- **Field:** `ProblemRepository` interface
- **Proposed change:** add `delete(id): Promise<boolean>` (soft delete: `is_published = false`), and make `findById` skip unpublished problems for non-admin reads.
- **Reason:** `DELETE /admin/problems` needs it. Until then the admin module takes a `deleteProblem` function and the server passes `unpublishProblem` (an `UPDATE problems SET is_published = false` in `modules/admin/routes.ts`). Known gap: `GET /problems/{id}` still returns an unpublished problem because `findById` doesn't filter.
- **Status:** pending
- **Approved by:** —

## CR-016

- **Proposed by:** Person 3 (Day 4), **for Person 1** (openapi owner)
- **Field:** stats endpoints in `openapi.yaml`
- **Proposed change (already served by the stats module, additive only):**
  1. New `GET /api/v1/stats/me/streak` (bearer) → `200 StreakStat & { days: string[] }` (`days` = UTC dates `YYYY-MM-DD`, ascending, on which the user first solved a problem; for the streak calendar).
  2. `GET /api/v1/stats/me` additionally returns `difficulties: [{ difficulty, attempted, solved }]` (difficulty chart) and now always includes `streak`.
  3. Document `429 TOO_MANY_REQUESTS` (+ `Retry-After` header) on `POST /auth/login` (login throttling), `409` already exists on register, `403 FORBIDDEN` on admin routes already exists.
- **Reason:** Day 4 stats dashboard (streak calendar, difficulty breakdown) and the Day 3 login throttling.
- **Status:** pending
- **Approved by:** —

## CR-017

- **Proposed by:** Person 3 (Day 4), **for Person 2**
- **Field:** `PostgresSubmissionRepository.save()`
- **Proposed change:** replace the inline `user_problem_stats` upsert with `await updateStatsOnSubmission(client, submission)` from `server/src/modules/stats/stats.service.ts` (same SQL, same transaction).
- **Reason:** one owner for the stats model (Person 3), no duplicate SQL. Behaviour is identical; `person3-postgres.test.ts` checks it under 10 concurrent transactions.
- **Status:** pending
- **Approved by:** —

## CR-018

- **Proposed by:** Person 3 (Day 5), **for Person 1** (`/core`)
- **Field:** `SandboxOptions` in `core/src/sandbox.ts`
- **Proposed change:** optional `nodePath?: string` and `extraEnv?: Record<string, string>` used by `childCommand` instead of the hard-coded `'node'` from `PATH`.
- **Reason:** the desktop app judges offline with core's sandbox. Today that needs a Node.js install on the user's machine; with the option the app can run its own Electron binary as Node (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`), so installers work on machines without Node.
- **Status:** pending
- **Approved by:** —

## CR-019

- **Proposed by:** Person 1 (Day 6), **for Person 2** (owner of `/server/src/db`) and **for Person 3** (API additions)
- **Changes already made (approved by Person 1's user), so the queue can retry, recover stalled jobs and dead-letter:**
  1. New migration `server/src/db/migrations/003_queue_reliability` (up + down, checked both ways): `submissions.attempts`, `run_after`, `lock_token`, `locked_until`, `last_error`; partial indexes on `running` rows (lease) and `failed` rows (dead-letter list). The `submissions_notify_queued` trigger now also fires on `UPDATE OF status` to `queued` (retries, requeue). No existing column changed. `PostgresSubmissionRepository` is unchanged and ignores the new columns.
  2. API additions in `/docs/openapi.yaml` (no existing behaviour changed): `POST /submissions` may return `429 QUEUE_FULL` with `Retry-After`; the `409 IDEMPOTENCY_KEY_REUSED` from CR-006 is now documented; new admin endpoints `GET /admin/queue/failed` and `POST /admin/queue/failed/{id}/requeue` (schema `FailedJob`). They live in `server/src/modules/submissions/admin-routes.ts` because they are queue operations, not problem admin (Person 3's `/admin` module is untouched). The role is read through Person 3's `AuthStore.findById`.
- **Please note (Person 2):** two migrations now share the number `002` (`002_submission_queue`, `002_sync_tables`). Both apply because `_migrations` stores the full name, but please renumber new ones from `004`.
- **Status:** done, needs Person 2's review
- **Approved by:** —

## CR-020

- **Proposed by:** Person 1 (Day 6), **for Person 2**
- **Problem:** `main` did not build after PR #7/#8. `core/src/storage/repositories/sqlite-submission.repository.ts` uses `result.passed/total/results`, which don't exist on core's `ExecutionResult` (same issue CR-007 fixed for PostgreSQL), and lacks `findByIdempotencyKey`. `core/src/sync/__tests__/hlc.test.ts:56` also fails to type-check. `server/src/db/repositories/audit.repository.ts` imported `AuditRepository`/`AuditEntry` from `@dsa-portal/core`, which did not export them.
- **Changes already made (Person 1's files only):** `core/src/index.ts` now re-exports the `AuditEntry` and `AuditRepository` types (type-only, so SQLite never loads in the server). `core/tsconfig.json` excludes `src/storage` and `src/sync` from core's build (nothing imports them yet), so `npm run build` is green again.
- **Proposed change (Person 2):** fix the SQLite submission repository to the `{ status, perTest }` shape, add `findByIdempotencyKey`, fix the HLC test, then remove the two excludes in `core/tsconfig.json`. Also, `npx eslint` reports an unused `PoolClient` import in `submission.repository.ts:1` (the only lint error in the repo).
- **Status:** done (final scan): SQLite repository fixed for the current types, `core/tsconfig.json` excludes removed; core builds storage + sync
- **Approved by:** —

## CR-021

- **Proposed by:** Person 1 (Day 7), **for the team** (stack decision) and **Person 2** (migration in `/server/src/db`)
- **Proposed change:** Day 7 without Redis or BullMQ, continuing CR-005:
  1. **Socket.IO fan-out over PostgreSQL `LISTEN/NOTIFY`, not Redis pub/sub + the Socket.IO Redis adapter.** Triggers (migration `005_realtime_events`, up + down, checked both ways) `pg_notify('dsa_events', …)` on every submission status change, on a fully passing submission (`leaderboard:updated`) and on a new `daily_challenges` row (`daily:new`). Each API instance LISTENs and emits to its own sockets, so several instances work. Also adds a partial index for the leaderboard on `user_problem_stats (first_solved_at) WHERE solved`. No existing column changed.
  2. **Daily challenge without a BullMQ repeatable job:** a deterministic pick (sha256 of the UTC date over the sorted published slugs), saved in the existing `daily_challenges` table by the worker just after each UTC midnight (and lazily by `GET /daily-challenge`). The insert announces it, so it fires once even with many workers.
  3. **Spec (additive):** `GET /leaderboard` gets `period=week|all` (default `all`) and a 400. Ranking is by problems solved, then the time the user reached that count (earlier wins), then user id. `totalScore` = Easy 1, Medium 2, Hard 3 per solved problem. `GET /daily-challenge` documents its 401. `docs/websocket-events.md` is rewritten with the Day 7 brief's event names; Person 3's unmerged client (fork) still uses the Day 1 draft names and must switch.
- **Trade-off:** NOTIFY payloads are capped at 8 KB and aren't replayed to disconnected clients. Clients keep REST polling as the fallback. If we ever need Redis (Person 3's caching), we can swap the event source behind the same `EventSource` interface without touching clients.
- **Status:** done, needs team sign-off and Person 2's review of migration 005
- **Approved by:** —

## CR-022

- **Proposed by:** Person 1 (Day 7), **for Person 3**
- **Context:** Person 3's fork (`ansarimehran24/DSA_Portal`, commit `b2e822a` and its siblings, not merged) adds its own `server/src/modules/{leaderboard,daily}/routes.ts` and edits `server/src/app.ts`, `server/src/index.ts` and `workers/src/main.ts`, which are Person 1's files. Person 1's Day 7 implementation of the same endpoints and of the socket gateway is now on `main` (CR-021).
- **Proposed change (before Person 3 merges their Day 7):**
  1. Drop the fork's `modules/leaderboard/routes.ts` and `modules/daily/routes.ts`. Use `main`'s (keyset pagination, `period=week|all`, daily saved per UTC day and announced with `daily:new`).
  2. Keep the Redis cache, but as a wrapper: a `CachedLeaderboardStore implements LeaderboardStore` around `PostgresLeaderboardStore` (key `period`) and a `CachedDailyChallengeStore implements DailyChallengeStore` (key: date). Pass them through `buildApp({ leaderboard, daily })`. Invalidate on the `leaderboard:updated` / `daily:new` events or keep the short TTLs. Person 1 will wire `cache` into `app.ts`/`index.ts` once it's on `main`. Send the wiring as a CR like CR-010, not an edit.
  3. `ui-core/src/realtime.ts`: connect with `io(url, { auth: { token } })` instead of emitting `auth:join`; listen for `submission:queued|running|finished` (payload `{ submissionId, problemId, status, passed, total }`; fetch per-test results over REST) and `leaderboard:updated` / `daily:new`. See `/docs/websocket-events.md`.
  4. Rename `004_session_families` to `006_session_families` (`004` and `005` are taken on `main`).
  5. `/metrics`: the worker already serves Prometheus on `WORKER_METRICS_PORT`. Put the API's cache counters there or at `GET /metrics` on the API, but agree the name with Person 2 so one scrape config covers both.
- **Status:** pending
- **Approved by:** —

## CR-023

- **Proposed by:** Person 1 (Day 8), **for Person 2 and Person 3** (FYI: additive API behaviour + server dependency upgrade)
- **Changes already made (Person 1's files):**
  1. **New 4xx responses, same `Error` body:** any route may return `429 RATE_LIMITED` (per IP 300/min, per signed-in user 120/min) and `413 PAYLOAD_TOO_LARGE` (body > 512 KiB). `POST /submissions` may return `429 QUOTA_EXCEEDED` (per user 10/min, 500/day). Every 429 has `Retry-After`. Code with a NUL character is now a `400 VALIDATION_ERROR` (was a 500 from PostgreSQL). Documented in `openapi.yaml`. No endpoint, field or event changed.
  2. **Security headers** on every response (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS, `CSP: default-src 'none'`), and a **CORS allow-list** (`CORS_ORIGINS`) shared with Socket.IO. In production with `CORS_ORIGINS` unset, browsers on other origins are refused. **Person 3:** add the web app's origin, and the desktop renderer's if it calls the API from the renderer. Native mobile and the CLI send no `Origin` and are unaffected.
  3. **Fastify 4 → 5** (`fastify` 5.12.8, `@fastify/jwt` 10.2.7, `@fastify/cors` 11.4.3) to fix the `npm audit` criticals (see `docs/threat-model.md`). Person 3's auth/admin/stats modules compile and pass their tests unchanged. `light-my-request` (used by `app.inject` in tests) is pinned to 6.6.0 as a server devDependency, because 6.8 pulls the ESM-only `cookie@2`, which Jest (CommonJS) can't load.
  4. Each submission writes an `audit_log` row (`action = 'submission.create'`) through Person 2's `PostgresAuditRepository`.
- **Clients (Person 3):** on 429, read `error` and wait `Retry-After`. `QUOTA_EXCEEDED` deserves its own message ("you've hit the submission limit, try again in N s").
- **Status:** done, FYI
- **Approved by:** —

## CR-024

- **Proposed by:** Person 1 (Day 8), **for Person 2** (owner of `/infra` and docker files)
- **Proposed change:** run the worker with reduced privileges and hard resource limits. There's no worker image yet; when you add the API and worker services to `infra/docker-compose.yml`, please use this for the worker:
  ```yaml
  worker:
    build: { context: .., dockerfile: infra/Dockerfile.worker } # FROM node:20-alpine … USER node
    command: node workers/dist/main.js
    user: 'node' # never root
    read_only: true # sandbox writes only to /tmp
    tmpfs: ['/tmp:size=64m,mode=1777']
    cap_drop: ['ALL']
    security_opt: ['no-new-privileges:true']
    pids_limit: 128 # WORKER_CONCURRENCY × 1 child + headroom; stops fork bombs at the kernel
    mem_limit: 512m # children are capped at 64 MB each by --max-old-space-size
    cpus: '1.0'
    environment: [DATABASE_URL, WORKER_CONCURRENCY, WORKER_METRICS_PORT] # NOT JWT_SECRET: the worker doesn't need it
  ```
  Inside it, each sandbox child already runs under Node's permission model (no fs writes, reads only its own temp dir, no child processes or worker threads) with a 64 MB heap, a 2 s per-test timeout and an env with only `PATH`.
- **Status:** pending
- **Approved by:** —

## CR-025

- **Proposed by:** Person 1 (Day 8), **for Person 3** (owner of `/web`, `/mobile`)
- **Context:** after Day 8's server fixes, the remaining `npm audit --omit=dev` findings (50: 1 critical, 21 high) are all in client toolchains, except zod (mitigated by the 512 KiB body limit). Full table in `docs/threat-model.md`.
- **Proposed change:**
  1. Mobile: plan the Expo SDK upgrade (51 → current) after the demo. It clears `tar` (critical), `@xmldom/xmldom`, `postcss`, `@expo/*`, `expo-router`, `@react-navigation/*` and the RN CLI findings. These are build-time tools, so there's no runtime risk for the demo.
  2. Web: React Router 6 → 7 clears `react-router`, `@remix-run/*` and `turbo-stream`. The SPA doesn't use the SSR paths those advisories are about.
  3. Test hygiene: `server/__tests__/person3-postgres.test.ts` › "keeps stats counters right under concurrent submissions" fails when run on its own against a fresh DB, because it needs the `two-sum` problem, which only `workers/__tests__/queue.e2e.test.ts` seeds. Seed it in that test's `beforeAll` (insert `two-sum` `ON CONFLICT DO NOTHING`).
- **Status:** pending
- **Approved by:** —

## CR-026

- **Proposed by:** Person 1 (Day 9), **for Person 2** (owner of `/.github`)
- **Proposed change:** add CI so the Day 9 full-flow test (`workers/__tests__/full-flow.e2e.test.ts`) and every other suite run on each push and PR. Ready-to-use `.github/workflows/ci.yml`:
  ```yaml
  name: ci
  on: [push, pull_request]
  jobs:
    test:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:16-alpine
          env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: dsa_portal_test }
          ports: ['5432:5432']
          options: >-
            --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
      env:
        TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/dsa_portal_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 20, cache: npm }
        - run: npm ci
        - run: npm run build
        - run: npx jest --runInBand # runInBand: suites share one database (parallel migrateUp on an empty DB races)
        - run: npm test -w ui-core && npm test -w web && npm test -w mobile
  ```
  The full-flow test builds and starts the real API and worker itself. It needs no Redis (CR-021).
- **Status:** done (final scan): CI sets TEST_DATABASE_URL and runs the ui-core, web and mobile suites
- **Approved by:** —

## CR-027

- **Proposed by:** Person 1 (Day 9), **for Person 2** (owner of `server/src/db/seed.ts`)
- **Problem:** the seeded `admin@dsa.portal` and `student@dsa.portal` can't log in. The hash in `seed.ts` (comment: "bcrypt hash for password123") doesn't match `password123`. `bcrypt.compare('password123', <hash>)` returns `false`.
- **Proposed change:** replace it with a real hash, e.g. the output of `node -e "require('bcryptjs').hash('password123', 10).then(console.log)"`, and add a seed test that `compare`s it.
- **Status:** done: seed hash verified against password123
- **Approved by:** —

## CR-028

- **Proposed by:** Person 2 (Day 5; logged as CR-002, renumbered because CR-002 already existed. Its merge had overwritten CR-002..CR-027, which are restored above)
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
- **Status:** done (final scan): `syncRoutes` mounted under /api/v1 via `buildApp({ postgresRoutes: true })`; openapi.yaml sync section rewritten to the real contract (+ /sync/bootstrap); ui-core types regenerated
- **Approved by:** —

## CR-029

- **Proposed by:** Person 1 (final scan, 2026-11-14), **for Person 2** (owner of `server/src/db`, `server/src/sync`, `infra`, migrations)
- **Problems found after merging Person 2's Days 5-9:**
  1. **`npm run build` fails in server** (so `workers/__tests__/*.e2e` fail too, they build first). Core now exports the sync types and HLC helpers (Person 1 did that part in `core/src/index.ts`). Still needed, verified in a scratch copy (build green, `queue.e2e` passes):
     - `server/src/db/pool.ts`, append:
       ```ts
       export type PoolMetrics = ReturnType<typeof getPoolMetrics>;
       export function getPool(): Pool {
         return pool;
       }
       ```
     - `server/src/sync/sync.controller.ts`: the access token payload is `{ sub }`, not `{ id }`, so `user.id` is always undefined (every call would 401). Delete `interface AuthenticatedUser`, use `const userId = req.user?.sub; if (!userId) ...` and `syncService.push/pull/bootstrap(userId, ...)`. Also `return reply.status(401)...` inside `requireAuth`.
  2. **Users can no longer be deleted.** `audit_log.actor_id` is `ON DELETE SET NULL` (001), which is an UPDATE, and 004's `trg_audit_log_immutable` rejects every UPDATE. `DELETE FROM users` fails for any user with audit rows (`full-flow.e2e` teardown fails with "audit_log is append-only"). Proposed: a new migration 007 whose trigger allows an UPDATE that only sets `actor_id` to NULL (`IF TG_OP = 'UPDATE' AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN RETURN NEW; END IF;`).
  3. `server/__tests__/security-roles.test.ts` connects with `DATABASE_URL` (the dev DB) and inserts rows there. Use `TEST_DATABASE_URL` like the other DB tests.
  4. `infra/docker-compose.prod.yml` sets `CORS_ORIGIN`, but the server reads `CORS_ORIGINS` (CR-023), so production allows no browser origin. Rename it.
  5. The Day 5 merge replaced this file with a single CR (CR-002..CR-027 were lost; restored, yours is now CR-028) and dropped ~20 variables from `.env.example` (restored, yours kept). Please merge `main` before editing shared files.
- **After 1 lands:** Person 1 registers `syncRoutes` in `app.ts` and adds the sync endpoints to `openapi.yaml` (CR-028).
- **Status:** done (final scan): all 5 items fixed (pool exports, `req.user.sub`, migration 007, security test on TEST_DATABASE_URL, CORS_ORIGINS); plus sync submission upsert scoped to the owner and `solved` boolean fix, see handover
- **Approved by:** —
