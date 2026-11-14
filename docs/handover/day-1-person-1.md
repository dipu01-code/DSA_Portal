# Handover — Day 1, Person 1

## What was built

Day 1 — Architecture, OpenAPI contract, and monorepo dev tooling. Built on top of Day 0 (person-1/day-0) foundation.

### Monorepo scaffold (root)

- `package.json` — npm workspaces for all 10 packages; scripts: `lint`, `lint:fix`, `format`, `format:write`, `test`, `test:core`, `dev:server`, `build`
- `tsconfig.json` — base TS config (`module: esnext`, `moduleResolution: bundler`, strict)
- `.eslintrc.json` — ESLint + `@typescript-eslint/recommended`, type-aware via project tsconfigs
- `.prettierrc` / `prettier.config.js` — Prettier formatting (printWidth 100, single quotes)
- `jest.config.js` — Jest with ts-jest transform, `passWithNoTests: true`, scoped to client/server/worker test dirs (excludes core vitest tests)
- `.gitignore`, `.env.example` (no secrets)
- `CLAUDE.md` — shared team context (stack, folder ownership, git conventions, API contract rule)

### /docs/architecture.md (Person 1)

- Mermaid component diagram (clients → API → engine/judge/cache/realtime → PostgreSQL/SQLite)
- Mermaid sequence diagram: submit → queue → worker → sandbox → result → client
- Mermaid deployment view (dev + production)
- Modular monolith vs microservices rationale for a 10-day project
- Stack + folder ownership recap + contract rule

### /docs/openapi.yaml (Person 1 — source of truth for /api/v1)

- Standard `Error` format (error/message/statusCode/timestamp/path) for all 4xx/5xx
- Keyset cursor pagination (`CursorPage` + `cursor`/`limit` query params)
- Auth: register, login, refresh, logout, me
- Problems: topics, list (filter topic/difficulty + cursor), random by topic/difficulty, get by id
- Hints (progressive), solutions (locked until solved)
- Submissions: create (202 queued), list, get by id
- Stats: me (overall + streak + per-topic), per-topic
- Leaderboard (cursor paginated)
- Daily challenge
- Admin: create/update/delete problem, add test cases
- Sync: push (local → server), pull (server → local, `since` filter)
- bearerAuth (JWT) + cookieAuth (refresh token) schemes
- Every endpoint has `operationId`

## Verification (real execution)

- `npm install` — OK
- `npm run lint` — 0 errors, 6 warnings → exit 0
- `npm test` (jest) — No tests found, exit 0 (empty client packages)
- `npm run test:core` — 6/6 vitest tests pass
- `tsc -p core` and `tsc -p server` — clean
- `npx @redocly/cli lint docs/openapi.yaml` — **valid** ✓ (exit 0, 17 warnings only)

## Known issues / caveats

- `no-explicit-any` warnings in `core/src/executor.ts` and `server/src/app.ts` (runtime `any` for request handlers/executor results) — acceptable, warnings only
- `no-console` warnings in `workers/src/index.ts` — acceptable, warnings only
- Core tests use vitest (Day 0); root `npm test` uses jest for future client packages
- Local Node is v26; stack targets v20 — pin `engines: "20.x"` and test on v20 in CI
- CLAUDE.md content is the shared team context; user will confirm/paste final version

## Branch / push

- Branch: `person-1/day-1` (based on person-1/day-0)
- Ready to merge into `main`; push timing controlled by the user

## Next (Day 2)

- Person 1: implement `/server/src/modules/{problems,hints,solutions,submissions,...}` per openapi.yaml
- Person 2: `/server/src/db` (PostgreSQL), `/core/src/storage` (SQLite), sync, `/infra` (Docker)
- Person 3: `/web`, `/desktop`, `/mobile`, `/ui-core`, `/server/src/modules/{auth,admin,stats}`, `/server/src/cache`
- Any endpoint/table/event change → log in `/docs/CHANGE_REQUESTS.md` first
