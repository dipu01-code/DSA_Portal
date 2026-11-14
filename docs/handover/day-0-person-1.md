# Handover — Day 0, Person 1

## What was built

Phase 0 — monorepo foundation for the DSA Practice Platform. A runnable npm-workspaces repo with the core engine and Fastify server shell. No front ends yet (Persons 3 owns web/desktop/mobile/ui-core).

### /core (engine, Person 1)

- `src/types.ts` — `Difficulty`, `Topic`, `Problem`, `TestCase`, `SubmissionResult`
- `src/problems.ts` — 3 sample problems (Two Sum, Palindrome Number, Merge Two Sorted Lists) + `getProblem`, `getRandomProblem`, `listProblems`
- `src/executor.ts` — runs user JS via `child_process` (`node`) against predefined test cases, compares output with `deepEqual`, catches runtime errors, cleans up temp files
- `src/index.ts` — barrel export
- `__tests__/problems.test.ts`, `__tests__/executor.test.ts` — 6 tests, all passing

### /server (Person 1 owns `src/app.ts`)

- `src/app.ts` — Fastify + pino + cors + `@fastify/jwt`, `/api/v1/health` (public), `/api/v1/problems` (JWT-protected, returns core problem list)
- `src/index.ts` — entry point, listens on `PORT` (default 3000)

### /workers (Person 1)

- `src/index.ts` — BullMQ `submissions` queue + worker skeleton (Redis localhost:6379), no-op job handler pending Person 2 storage sync

### /docs (Person 1 owns architecture/openapi/websocket-events)

- `architecture.md`, `openapi.yaml` (source of truth for `/api/v1`), `websocket-events.md`, `CHANGE_REQUESTS.md`

## Verification (real execution)

- `npm install` — OK (1315 packages)
- `npm run test:core` — 6/6 tests pass
- `tsc -p core` and `tsc -p server` — clean, no errors
- Server starts on `:3000`; `GET /api/v1/health` → `{"status":"ok","service":"dsa-portal-server"}`; `GET /api/v1/problems` without JWT → `401` (auth middleware working)

## How to run

```
cd /Users/dipu/DSAPortal
npm install                # install all workspaces
npm run test:core          # core engine tests
PORT=3000 JWT_SECRET=dev-secret npx tsx server/src/index.ts   # start server
curl http://localhost:3000/api/v1/health
```

Build: `npx tsc -p core` / `npx tsc -p server`.

## Endpoints / tables / events others can use

- `GET /api/v1/health` — public
- `GET /api/v1/problems` — `Authorization: Bearer <JWT>`, returns `{ problems: [{id,title,topic,difficulty}] }`
- `@dsa-portal/core` exports `submitCode({problem, userCode})` → `SubmissionResult`
- BullMQ queue `submissions` on Redis `localhost:6379` (worker stub)
- No DB tables yet — Person 2 owns `/server/src/db`, `/core/src/storage`

## Known issues / caveats

- Local Node is v26.13.0; team agreed Node 20. `engines` pinned to `20.x` in root `package.json`; CI should test on v20.
- `npm` doesn't support the `workspace:` protocol in dependencies — used plain `"*"` range for `@dsa-portal/core` (workspaces still symlink correctly).
- Executor runs untrusted JS in a plain `child_process` — no sandbox yet; hardening is a known follow-up.
- Server JWT secret defaults to `dev-secret-change-me` — must be set via `JWT_SECRET` in production (`.env.example` provided, no secrets committed).

## Design decisions / trade-offs (for viva)

- npm workspaces monorepo: single repo matches team structure; shared types across core/server/workers; one `node_modules`.
- `child_process` for JS execution: matches existing CLI behavior; sandboxing deferred.
- `better-sqlite3` local + PostgreSQL server: offline-first CLI syncs later (sync/storage = Person 2 folders).
- Fastify + zod + pino: agreed stack, fast validation + structured logging.
- Caveat: local Node v26 vs agreed v20 — pin engines and test on v20 in CI.

## Branch / push

- Committed on `person-1/day-0` (commit `91ccc14`).
- NOT pushed to main — you control push timing.

## Next (Day 1)

- Person 2: wire `/server/src/db` (PostgreSQL), `/core/src/storage` (SQLite), sync, `/infra` (Docker).
- Person 3: `/web`, `/desktop`, `/mobile`, `/ui-core`, `/server/src/modules/{auth,admin,stats}`, `/server/src/cache`.
- Any change to agreed endpoints/tables/WebSocket events → log in `/docs/CHANGE_REQUESTS.md` first.
