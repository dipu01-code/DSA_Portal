# Day 3 — Person 3: auth backend, admin endpoints, web login

## What was built

**Backend** (`server/src/modules/auth`, `server/src/modules/admin`)

- Register, login, refresh, logout, me; bcrypt cost 12 (`BCRYPT_COST`); access 15 min; refresh 7 days stored hashed in `sessions`; **refresh rotation with reuse detection** (atomic consume, reuse revokes all the user's sessions).
- `authenticate` and `authorize(store, role)` Fastify hooks (`modules/auth/hooks.ts`).
- Admin: create / update / delete problem, add test cases; validated with core's zod `ProblemSchema` (`validateProblem`), unknown fields rejected, slug ids, delete = unpublish.
- Password policy (8–72 bytes, letter + digit, not containing username/email), login throttling (5 per IP+email, 20 per IP, 15 min → 429 + Retry-After), constant-time behaviour for unknown emails, one message for all login failures.
- Threat list: `docs/design/auth-design.md`.

**Client** (`/web`): React + Vite + React Router; login and register pages; topic + difficulty selector; theme switch; all on `/ui-core`.

## How to run

```bash
npx jest server/__tests__/auth.test.ts                                   # 25 tests (auth, throttle, policy, admin)
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest person3-postgres   # Postgres store, concurrent refresh
npm run dev -w web            # http://localhost:5173 (proxies /api to :3000)
npm run dev:mock -w web       # without a server
```

## Middleware usage for Persons 1 and 2

```ts
import { authenticate, authorize } from './modules/auth/hooks';
app.decorate('authenticate', authenticate);  // drop-in for the TEMP stub (CR-010)
{ onRequest: app.authenticate }                                        // signed in; req.user.sub = user id
{ onRequest: app.authenticate, preHandler: authorize(authStore, 'admin') } // 403 FORBIDDEN otherwise
```

**Wiring needed in `app.ts`/`index.ts` (Person 1):** CR-010 has the exact lines; `server/__tests__/helpers/person3-app.ts` shows them working.

## Endpoints

| Method          | Path                                     | Auth   | Returns                                    |
| --------------- | ---------------------------------------- | ------ | ------------------------------------------ |
| POST            | `/api/v1/auth/register`                  | –      | 201 `User` · 400 · 409                     |
| POST            | `/api/v1/auth/login`                     | –      | 200 `TokenPair` + cookie · 401 · 429       |
| POST            | `/api/v1/auth/refresh`                   | cookie | 200 `{accessToken}` + rotated cookie · 401 |
| POST            | `/api/v1/auth/logout`                    | cookie | 204                                        |
| GET             | `/api/v1/auth/me`                        | bearer | 200 `User` · 401                           |
| POST/PUT/DELETE | `/api/v1/admin/problems`                 | admin  | 201/200/204 · 400 · 403 · 404 · 409        |
| POST            | `/api/v1/admin/problems/{id}/test-cases` | admin  | 200 `{testCases}`                          |

Tables: `users`, `sessions` (no schema change), `problems` (unpublish).

## Known issues

1. Routes not wired in `app.ts` yet (CR-010). 2. Seed users can't log in until CR-012. 3. Rotation uses `expires_at = epoch` as the "rotated" marker (CR-014 for proper columns); reuse revokes every device. 4. Throttle is per process (Redis on Day 7). 5. `ProblemRepository` has no delete; `findById` still returns unpublished problems (CR-015). 6. Login 429 not in the spec yet (CR-016).

## Design decisions (viva)

- **Rotation + reuse detection:** a stolen refresh token works at most until the real user's next refresh, then both are logged out, which surfaces the theft.
- **Atomic consume (`UPDATE … WHERE expires_at > now() RETURNING`)** instead of read-then-write: no race between two refreshes.
- **Throttle on IP+email and on IP:** the first stops guessing one account, the second stops credential stuffing across accounts; a correct login clears only the account counter.
- **Validate admin input with core's zod schema:** one source of truth for what a valid problem is (server, seeder, CLI).
- **Soft delete:** submissions and stats keep pointing at a real row.
