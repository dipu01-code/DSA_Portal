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

- **Fixed (Person 1):** `core` exports the sync types and HLC helpers that `server/src/sync` imports. Restored `docs/CHANGE_REQUESTS.md` (CR-002..CR-027 were overwritten in a merge; Person 2's sync CR is now CR-028) and the ~20 lost `.env.example` variables.
- **Open, for Person 2 (CR-029):** server build fails on 5 type errors in `db/pool.ts` and `sync/sync.controller.ts` (exact patch in the CR, verified: build green, `queue.e2e` passes). Deleting a user fails, because the append-only `audit_log` trigger blocks `ON DELETE SET NULL`. `security-roles.test.ts` uses the dev DB. Prod compose uses `CORS_ORIGIN` instead of `CORS_ORIGINS`.
- **Results (fresh DB, with the CR-029 build patch):** 29/30 jest suites, 209 passed / 2 skipped; the only failure is the `full-flow.e2e` teardown (user delete, item 2 above). ui-core 54, web 15, mobile 18 tests pass; all client workspaces typecheck clean.
- **Local dev DB:** it still records `004_session_families` (now `006_`). Recreate it (`npm run db:reset`) before running migrations.
