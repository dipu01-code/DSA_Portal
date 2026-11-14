# Handover: Day 10, Person 1 (API docs, report, demo)

## What was built

- **API reference at `GET /docs`** (Redoc) and the raw spec at `GET /docs/openapi.yaml`, both served by the API from the same `docs/openapi.yaml` the contract test checks. The contract test calls every `/api/v1` route and validates its responses against the spec, so "openapi.yaml matches the real behaviour" is enforced by `npm test`, not by hand. Redoc is a pinned CDN script (no new dependency). That one page gets a CSP allowing only that script; every other route keeps `default-src 'none'`.
- **`docs/report/part-1.md`**: architecture, execution engine and sandbox security, queue design, real-time design, hardening, scalability (with the load-test numbers), trade-offs, future work. Six Mermaid diagrams: components, sequence, sandbox walls, queue state machine, plus the existing ones it links.
- **`docs/demo-script.md`**: a 5-minute demo of submit → live feedback, with what to say and show, hostile samples, chaos, load numbers and a "if something breaks" section.
- **`server/README.md`** (backend: start in ~5 minutes, configuration, tests, layout, troubleshooting) and a short root `README.md` that points to it.
- **Dead code:** scanned every export in Person 1's folders. All are used (the in-memory stores are the test doubles). The remaining lint errors are all in Person 2's folders (already in CR-020). `docs/api-examples.md` and `architecture.md` now cover Days 8–10.

## Fresh-clone check

Done on 2026-11-14 from a new `git clone` of this commit, following `server/README.md` literally (local PostgreSQL in place of `npm run db:up`):

- `npm ci` → `npm run build` → `npm run db:migrate && npm run db:seed`: **18 s** with a warm npm cache. Expect 1–3 min on a cold cache, still well under 10 minutes.
- API + worker started, then the README's curl flow ran verbatim: register → login → random problem → submit → **judged 5/5** → stats `attempted 1, solved 1, streak 1`. `/docs` returned 200, and `/docs/openapi.yaml` was the spec.
- `npm test` (no database): **148 passed, 17 skipped** (the PostgreSQL suites).
- `TEST_DATABASE_URL=… npx jest --runInBand` on a fresh database: **165 / 165 passed** (full flow, queue e2e, chaos, real time, security).

## How to run

```bash
npm ci && npm run db:up && npm run build && npm run db:migrate && npm run db:seed
npm run start -w server     # http://localhost:3000/docs
npm run start -w workers
```

## For Persons 2 and 3

- Open CRs from Person 1: **CR-023** (FYI: 413/429, headers, CORS, Fastify 5), **CR-024** (worker container hardening, P2), **CR-025** (client dependency upgrades + a test-order fix, P3), **CR-026** (CI workflow, P2), **CR-027** (seeded users' password hash, P2). Older: CR-019/020/021 (P2 reviews), CR-022 (P3 Day 7 merge).
- Demo day: start the server with `SUBMIT_QUOTA_PER_MINUTE=100` so live demos never hit the quota.

## Known issues

1. The seeded `student`/`admin` users can't log in until CR-027 lands. Register a user instead (README shows how).
2. `/docs` loads Redoc from `cdn.redoc.ly` (pinned version, no SRI hash), so the docs page needs internet. The spec itself is served locally.
3. CI isn't running until CR-026 is merged. Locally and on a fresh clone the full suite is green (165/165).

## Design decisions (for the viva)

- **The spec is enforced, not just documented:** the contract test fails the build if a route or response leaves the spec. Docs are rendered from the same file, so the page can't be stale.
- **Redoc from a CDN:** zero dependencies and one route. The cost is a third-party script, so the page's CSP allows exactly that origin and nothing else.
- **README tested by a fresh clone:** the instructions were followed literally from a new clone, so they reflect what actually works.

## Final scan after Persons 2 and 3 merged (2026-11-14)

Done with the whole team's folders unlocked. Nothing committed yet.

- **Build:** `server` compiles again (pool exports, sync controller reads `req.user.sub`). Core now also builds
  `src/storage` and `src/sync` (CR-020); `verdictOf` moved to core and is shared by the Postgres and SQLite repositories.
- **Sync (CR-028):** `/api/v1/sync/{push,pull,bootstrap}` mounted when `buildApp({ postgresRoutes: true })` (set in
  `server/src/index.ts`), plus `/health`, `/health/live`, `/health/ready` and `/metrics` at the root (the Dockerfile
  health check and Prometheus already pointed there). Fixed two sync bugs: a user could overwrite another user's
  submission by id, and the stats recompute wrote an integer into the boolean `solved` (every push failed).
  OpenAPI sync section matches the code; `ui-core` types regenerated. Test: `server/__tests__/sync-routes.test.ts`.
- **Database:** migration `007_audit_log_actor_delete` lets `ON DELETE SET NULL` clear `audit_log.actor_id`, so users
  can be deleted again; any other UPDATE/DELETE on `audit_log` is still rejected (tested).
- **Ops:** worker images build `server` (the worker imports its repositories) and start `main.js`, not the library
  `index.js`. Prod compose uses `CORS_ORIGINS`. Backups fail loudly (`pipefail`, no fake fallback file); restore runs
  in one transaction with `ON_ERROR_STOP`.
- **CI:** lint (22 errors) and Prettier (230 files) were failing; both clean now (`.prettierignore` for generated
  files). CI sets `TEST_DATABASE_URL` and runs the client suites.
- **Restored:** `docs/CHANGE_REQUESTS.md` (CR-002..CR-027 lost in a merge) and `.env.example` variables.
- **Results:** `npm run build`, lint and format clean; jest 31/31 suites (215 passed, 2 skipped) on a fresh DB;
  ui-core 54, web 15, mobile 18; every workspace typechecks.
- **better-sqlite3 + Docker (later the same day):** better-sqlite3 is an optional dependency of core (server
  images can't compile it and don't need it); the adapter's silent in-memory fallback is removed (it "saved" offline
  data into memory). Real-SQLite tests: `core/__tests__/storage/sqlite-repositories.test.ts`; the sync-engine tests
  now run on real SQLite too. Production stack fixed and verified with Docker: images ship `core/problems`,
  migrations and `openapi.yaml`; a one-shot `migrate` service replaces a broken init mount (pointed at a missing
  file and only ever applied 001); nginx waits for a healthy API, re-resolves it after redeploys (1.27 `resolve`),
  no longer sends conflicting security headers, and hides `/metrics`. Smoke test through nginx: 20/20 (register,
  login, problems, submit judged by the worker container, sandbox timeout, stats, leaderboard, daily, sync, docs,
  headers). Jest 32/32 suites (217 passed, 2 skipped).
- **Known issues:** offline submissions pushed through `/sync/push` are trusted as judged by the client.
  The API's per-test results don't include the error text (timeouts look like wrong answers). Old local dev DBs that recorded `004_session_families` need `npm run db:reset`.
