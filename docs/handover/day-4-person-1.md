# Handover — Day 4, Person 1

## What was built

Fastify REST API in `/server` following `/docs/openapi.yaml` (on `main`, **not committed yet**).

| Method | Path                            | Auth   | Notes                                                                |
| ------ | ------------------------------- | ------ | -------------------------------------------------------------------- |
| GET    | `/api/v1/topics`                | none   | topics that have problems                                            |
| GET    | `/api/v1/problems`              | bearer | `topic`, `difficulty`, keyset `cursor` + `limit`                     |
| GET    | `/api/v1/problems/random`       | bearer | 404 if nothing matches                                               |
| GET    | `/api/v1/problems/:id`          | bearer |                                                                      |
| GET    | `/api/v1/problems/:id/hints`    | bearer | `upto=N` → first N hints                                             |
| GET    | `/api/v1/problems/:id/solution` | bearer | 403 `SOLUTION_LOCKED` until the user passed every test               |
| POST   | `/api/v1/submissions`           | bearer | runs the sandbox synchronously, returns 202 `{submissionId, status}` |
| GET    | `/api/v1/submissions`           | bearer | own submissions, newest first, keyset                                |
| GET    | `/api/v1/submissions/:id`       | bearer | 404 for other users' submissions                                     |

Files: `server/src/app.ts`, `server/src/lib/http.ts`, `server/src/modules/{problems,hints,solutions,submissions}/`.
curl examples: `/docs/api-examples.md`.

## How to run

```bash
npm install && npm run build
npm run start -w server              # PORT (default 3000), JWT_SECRET, LOG_LEVEL
TOKEN=$(npm run -s dev:token -w server)   # TEMP dev token until /auth/login exists
npx jest                             # 62 tests, all green
```

## For Person 3 (clients + auth)

- **Auth stub:** `app.authenticate` in `server/src/app.ts` only verifies a JWT and reads `sub` as the user id. When your middleware in `/server/src/modules/auth` is ready, it must set `req.user.sub` (uuid); then we swap the decorator.
- Submission shape: `{ id, problemId, userId, status: queued|running|judged|failed, passed, total, results[{testCaseIndex, passed, actual, expected}], createdAt, judgedAt }`. `actual`/`expected` are JSON strings.
- Error body everywhere: `{ error, message, statusCode, timestamp, path }`; codes used: `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `SOLUTION_LOCKED`, `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`, `INTERNAL_ERROR`.
- Every response has an `x-request-id` header.

## For Person 2 (repositories)

- Server uses `ProblemRepository` and `SubmissionRepository` from `@dsa-portal/core` through in-memory fakes (`server/src/modules/*/in-memory-*.repository.ts`). `buildApp({ problems, submissions })` accepts your implementations — no route changes needed.
- Needed for real keyset pagination: `findAll` sorted by `id`, `findByUser` sorted by `(created_at DESC, id DESC)`. Today the server sorts in memory.
- Core `Submission` gained an optional `judgedAt?: Date` (maps to the spec's `judgedAt`).

## Fixes to earlier days made today

- **Build output was broken:** root `tsconfig.json` emitted ES modules into packages without `"type": "module"`, so `node dist/index.js` crashed for core/server/cli/workers. Switched to `module: CommonJS`.
- **Sandbox test crashed Jest** in parallel runs (memory-bomb child dumped its crash trace into the Jest worker). The sandbox child now gets `stdio: ['ignore','pipe','ignore']`.
- **Sandbox leaked the whole server env** (would include `JWT_SECRET`, `DATABASE_URL`) to untrusted code. Child now gets only `PATH` and `NODE_OPTIONS`.
- Jest maps `@dsa-portal/core` to `core/src` so tests never use a stale build.
- **Sandbox escape fixed:** user code could get the child's real `process` (via `console.log.constructor('return process')()` or the `input` object), and a backtick in the code could break out of the wrapper's template string into host code. Now `sandbox-exec.js` reads user code from its own file, the vm context holds no host objects (console, input and runner are built inside it), string code generation (`eval`/`Function`) is off, and the verdict is built from built-ins captured before user code runs, so code can't fake a pass. `const solve = ...` still works. 11 escape tests in `core/__tests__/sandbox.test.ts`; also checked over HTTP.

## Known issues

1. **Sandbox residual risk:** `vm` is still not a hard security boundary. If a new vm escape is found, the code runs as a normal Node process with the server user's file and network access, limited only by the time/memory/env limits. Future work: Node permission flags or a container/gVisor per job (Day 8 threat model).
2. `POST /submissions` blocks the event loop while judging (up to ~6 s for an infinite loop). Day 5 moves it to BullMQ.
3. Spec gaps logged as CR-002 (health), CR-003 (400/401 not documented), CR-004 (`Problem.solution` bypasses the locked solution endpoint).
4. Data is in memory and resets on restart until Person 2's repositories are merged.

## Design decisions (for the viva)

- **Modules as Fastify plugins with injected repositories:** routes depend on core interfaces, not on a database, so fakes and Person 2's Postgres repos are interchangeable and tests need no DB.
- **zod in handlers, one error handler:** each route parses its own input; `ZodError`, `HttpError` and Fastify's 4xx all become the same Error body, so clients handle one format.
- **202 even though judging is sync today:** clients already poll `GET /submissions/:id`, so Day 5's queue changes nothing for them.
- **Opaque base64url cursor of the sort key:** same contract works for the in-memory fake and a SQL `WHERE (created_at, id) < (...)` keyset query; no offset scans.
- **Other users' submissions return 404, not 403:** no way to probe which ids exist.
- **Request id from `x-request-id` or a fresh UUID:** pino adds it to every log line and it's echoed back, so a client error can be found in logs.
- **Contract test reads openapi.yaml at test time** and validates every registered route's responses with Ajv, so drift between code and spec fails CI.
