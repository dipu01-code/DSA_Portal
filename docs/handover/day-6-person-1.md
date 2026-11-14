# Handover: Day 6, Person 1

## What was built

Queue reliability on the PostgreSQL queue (CR-005). Full design: [`/docs/queue-design.md`](../queue-design.md).

- **Retries with exponential backoff:** an infrastructure error puts the job back to `queued` with `run_after = now + WORKER_BACKOFF_MS · 2^(n-1)`. Wrong answers, timeouts and sandbox crashes are normal `judged` results and are never retried.
- **Dead-letter list:** after `WORKER_MAX_ATTEMPTS`, the status becomes `failed` and `last_error` records why. Admin endpoints: `GET /api/v1/admin/queue/failed` (keyset pagination) and `POST /api/v1/admin/queue/failed/{id}/requeue`.
- **Stalled jobs:** every claim takes a lease (`locked_until`) and a fresh `lock_token`, and a heartbeat renews it. If a worker is SIGKILLed or OOM-killed, another worker re-claims the job once the lease runs out. A worker that lost its lease can't save (fencing token), so the user gets exactly one result. A job that kills its worker every time is dead-lettered instead of crash-looping.
- **Graceful shutdown:** SIGTERM/SIGINT stop new claims, finish in-flight jobs, then exit 0 (from Day 5; still covered by tests).
- **Backpressure:** `POST /submissions` returns `429 QUEUE_FULL` with `Retry-After` once `QUEUE_MAX_WAITING` submissions are waiting. Idempotent replays are still answered.
- **Metrics:** each worker serves Prometheus `GET /metrics` on `WORKER_METRICS_PORT`.
- **Chaos script:** `workers/scripts/chaos.ts` kills a worker mid-job and proves the job is processed again exactly once. It passes.
- Migration `003_queue_reliability` (up + down). OpenAPI updated (429, documented 409, 2 admin routes). Contract test covers them.
- Also fixed: `main` didn't build after the latest merges. See CR-020.

## How to run

```bash
npm install && npm run build
npm run db:migrate                      # applies 003
npm run start -w server                 # terminal 1
WORKER_METRICS_PORT=9464 npm run start -w workers   # terminal 2, add more terminals to scale out
curl -s localhost:9464/metrics
```

Tests:

```bash
npx jest                                # 94 pass; the 9 PostgreSQL tests skip without a database
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest   # 103/103, includes the chaos run
DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npm run chaos -w workers   # standalone
```

New env vars are in `.env.example`: `WORKER_MAX_ATTEMPTS`, `WORKER_BACKOFF_MS`, `WORKER_LEASE_MS`, `WORKER_METRICS_PORT`, `QUEUE_MAX_WAITING`, `QUEUE_RETRY_AFTER_S`.

## For Person 2 (Prometheus, DB)

Metric names (all prefixed `dsa_queue_`):

| Metric                                                              | Type                   | Aggregate with                                                |
| ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `dsa_queue_waiting`                                                 | gauge                  | `max` (queue-wide, every worker reports the same)             |
| `dsa_queue_active`                                                  | gauge                  | `max`                                                         |
| `dsa_queue_failed`                                                  | gauge                  | `max` (dead-letter size)                                      |
| `dsa_queue_jobs_total{outcome="judged\|retried\|dead\|lease_lost"}` | counter                | `sum(rate(...))`                                              |
| `dsa_queue_job_duration_seconds`                                    | histogram (0.1 … 30 s) | `histogram_quantile(0.95, sum(rate(..._bucket[5m])) by (le))` |

Scrape target: every worker on `WORKER_METRICS_PORT`. Connections per worker process: `WORKER_CONCURRENCY + 2`.
Please review CR-019 (migration 003 in your folder) and CR-020 (build fixes needed in `core/src/storage` and `core/src/sync`).

## For Person 3 (clients)

- On `429 QUEUE_FULL`, wait `Retry-After` seconds and resend **with the same Idempotency-Key**.
- `failed` now means "the system gave up after retries" (an admin can requeue). Show "something went wrong on our side", not "wrong answer".
- An admin UI can use the two `/admin/queue/failed` endpoints. The role is checked through your `AuthStore.findById` (wired in `server/src/index.ts`).

## Known issues / next

1. Retries in backoff and stalled jobs are found by polling, so a recovery can lag by up to `WORKER_POLL_MS` (2 s default) plus the lease.
2. Small remaining double-save window: a worker passes its ownership check, then freezes for longer than a whole lease before its save commits. Closing it needs the token check inside the repository's save transaction (Person 2's code). See queue-design.md.
3. The `LISTEN` connection still doesn't reconnect; polling covers it.
4. CR-010 (wiring Person 3's auth and stats routes into `app.ts`) is still open. The admin routes only use `AuthStore.findById`.
5. The Postgres keyset-pagination test for the dead-letter list runs on a near-empty test DB. The in-memory API test covers paging across rows.

## Design decisions (for the viva)

- **Leases + fencing token rather than "running forever":** a dead worker can't hand back its jobs, so a job's ownership expires instead. The new `lock_token` on each claim makes sure a slow "zombie" worker can't save over the new owner's result.
- **Attempts counted at claim time:** a job that crashes its worker still uses up a try, so a poison pill ends in the dead-letter list rather than a crash loop.
- **Retry only infrastructure errors:** a wrong answer or a timeout is a correct verdict. Retrying it would only waste CPU and change nothing.
- **Dead letter = `status = failed` in the same table:** no second queue to keep in sync. Requeue is a single UPDATE, and the trigger wakes a worker.
- **Backpressure at the API:** refusing early with 429 + Retry-After keeps latency bounded for accepted jobs, instead of letting an unbounded backlog build up.
- **Hand-written Prometheus text instead of `prom-client`:** about 40 lines, no new dependency. Queue depths are read from the database at scrape time, so they are never stale.
