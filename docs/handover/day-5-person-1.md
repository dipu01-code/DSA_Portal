# Handover — Day 5, Person 1

## What was built

Asynchronous judging with a **PostgreSQL-backed queue** (team decision: PostgreSQL only, no Redis/BullMQ — CR-005).

- `POST /api/v1/submissions` validates, saves the submission as `queued`, and returns `202 {submissionId, status: "queued"}` at once. Optional `Idempotency-Key` header: a retry returns the first submission; the same key with a different body gets `409 IDEMPOTENCY_KEY_REUSED`.
- **Worker process** (`/workers`, separate entry point `workers/src/main.ts`): runs `WORKER_CONCURRENCY` loops that claim the oldest queued row with `FOR UPDATE SKIP LOCKED`, judge it with the new non-blocking `submitCodeSandboxAsync`, and save the result through Person 2's `PostgresSubmissionRepository` (which also updates `user_problem_stats`). Woken instantly by `LISTEN/NOTIFY`, with a poll fallback. Finishes its current jobs on SIGTERM/SIGINT before exiting.
- `GET /api/v1/submissions/:id` returns the status and, once finished, per-test results (unchanged contract).
- Migration `002_submission_queue` (up + down): `idempotency_key` column + unique index per user, partial index on queued rows, `pg_notify` trigger.
- Person 2's database code now compiles and runs (details in CR-007).
- Sequence diagram updated in `/docs/architecture.md` §2; curl examples in `/docs/api-examples.md`.

## How to run

```bash
createdb dsa_portal
export DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal
npm run db:migrate && npm run db:seed
npm run build
npm run start -w server     # terminal 1
npm run start -w workers    # terminal 2 (WORKER_CONCURRENCY, WORKER_POLL_MS)
```

Tests:

```bash
npx jest                    # 82 pass; the 4 end-to-end tests skip without a database
createdb dsa_portal_test
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest   # 86/86
```

The end-to-end test builds the project, starts the real `workers/dist/main.js` as a separate process, submits through the API and checks: judged by the other process, exactly-once judging with concurrency 2 (hostile code included), concurrent Idempotency-Key retries create one row, and a clean SIGTERM shutdown.

## For Person 3 (clients)

Submit, then poll `GET /submissions/:id` (e.g. every 500 ms–1 s) until `status` is `judged` or `failed`. Day 7 adds a socket push so polling can stop.

| status    | meaning                                     | `passed`/`total`/`results` |
| --------- | ------------------------------------------- | -------------------------- |
| `queued`  | waiting for a worker                        | 0 / 0 / []                 |
| `running` | a worker has claimed it                     | 0 / 0 / []                 |
| `judged`  | finished; `passed === total` means accepted | filled                     |
| `failed`  | system failure (not a wrong answer)         | may be empty               |

Send an `Idempotency-Key` (e.g. a UUID per click of "Submit") so retries after a timeout don't create duplicates.
Stats hook: `StatsService.onSubmissionJudged(submission)` in `workers/src/judge.ts` is a stub; plug your stats service in there.

## For Person 2 (database, DevOps)

- **No Redis is needed for Day 5.** Requirements are on PostgreSQL: migrations 001 + 002 applied, one extra long-lived connection per worker process (for `LISTEN`), pool size ≥ `WORKER_CONCURRENCY + 2`.
- I changed files in `/server/src/db` with my user's approval so Day 5 could run end to end. Please review CR-007 in `/docs/CHANGE_REQUESTS.md`.
- Docker no longer creates the schema at boot (that left `_migrations` empty and broke `db:migrate`); always run `npm run db:migrate` after `npm run db:up`.

## Known issues / next

1. A worker killed with SIGKILL leaves its rows in `running` forever (no stalled-job recovery yet) → Day 6.
2. No retries: an infrastructure error marks the submission `failed` → Day 6 adds retries with backoff + a dead-letter list.
3. If the worker's `LISTEN` connection drops, it falls back to polling every `WORKER_POLL_MS` (no reconnect).
4. `PostgresProblemRepository.findAll` does 1 + 3 queries per problem; `GET /problems` and `/problems/random` will be slow under load → Day 9.
5. The overall verdict after a database read-back is rebuilt from per-test rows (`timeout`/`error`/`failed`/`passed`); fine for clients, which only use `passed/total`.
6. CR-005 (queue on PostgreSQL), CR-006 (document Idempotency-Key + 409) and CR-007 (Person 2's code) need sign-off.
7. `npm install` reports 12 known vulnerabilities in dependencies → Day 8 (`npm audit`).

## Design decisions (for the viva)

- **PostgreSQL as the queue:** the submission row _is_ the job, so creating the job and saving the submission can't get out of sync, and there's one service fewer to run and secure. Trade-off: we build retries, stalled-job recovery and metrics ourselves (Day 6) instead of getting them from BullMQ.
- **`FOR UPDATE SKIP LOCKED`:** many workers, on one machine or many, claim different rows without blocking each other. That's how we scale horizontally: just start more worker processes.
- **`LISTEN/NOTIFY` + polling:** a trigger wakes idle workers within milliseconds; polling covers missed notifications, so correctness never depends on NOTIFY.
- **Exactly once from the user's view:** SKIP LOCKED gives each row to one worker; `judgeSubmission` skips rows that are already finished; the unique `(user_id, idempotency_key)` index stops duplicate POSTs even when retries race (verified by counting `user_problem_stats.attempts`).
- **Async sandbox:** the old sync sandbox froze the whole process, so concurrency > 1 was impossible. `submitCodeSandboxAsync` shares all security settings with the sync version (one `childCommand` helper); two infinite loops now finish in ~1 s together instead of 2 s.
- **Repository-agnostic judge:** `judgeSubmission(id, {problems, submissions, stats})` works with in-memory or PostgreSQL repositories, so API tests run without a database and the end-to-end test uses the real one.
