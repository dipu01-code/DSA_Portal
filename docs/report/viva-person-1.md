# Viva prep: Person 1 (Backend, Core Engine and System Design)

Short answers to say out loud. Each one points to the code or doc that proves it. Longer write-up: [`part-1.md`](./part-1.md).

## The 60-second pitch

We turned a single-user Node CLI into **one engine behind four front ends** (CLI, web, desktop, mobile).
The backend is a **modular monolith plus a separate worker**. PostgreSQL is the only stateful service: it holds
the data, it is the **job queue** (`FOR UPDATE SKIP LOCKED`), and it is the **event bus** (`LISTEN/NOTIFY` triggers).
Untrusted code runs in a **child process with a fresh `vm` context per test**, behind Node's permission model.
A load test found the real bottleneck (Node startup), and fixing it made the system **6× faster at p50, 7.5× at p95, and 6.4× higher in
throughput**, with 0% errors.

## Numbers to remember

| What                                       | Value                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| Load test: 100 concurrent submissions      | p50 6.1 s → **1.0 s**, p95 12.7 s → **1.7 s**, 7.5 → **47.8 subs/s**, 0% errors |
| Node startup share of judging CPU (before) | ~95% (one process per _test_)                                                   |
| Sandbox limits                             | 2 s per test, 30 s total, 64 MB heap, 50 KB output, env = `PATH` only           |
| Request limits                             | 300 req/min per IP, 120/min per user, 10 submissions/min and 500/day per user   |
| Body limit                                 | 512 KiB (`app.ts`)                                                              |
| Queue                                      | 3 attempts, backoff 1 s · 2^(n-1), 30 s lease, 429 at 500 waiting               |
| Tests (CI)                                 | 36 server/core suites (289 tests) + ui-core 54 + web 34 + mobile 18             |

---

## 1. Architecture

**Q: Why a monolith and not microservices?**
Three people, ten days. Microservices need service discovery, tracing, per-service CI and network failure handling.
A monolith gives one repo, one install, one test run, and types shared through npm workspaces. We split out **only
the part with a different resource profile**: judging is CPU-heavy, slow and untrusted, so it runs in its own worker
process and scales on its own. (`docs/architecture.md` §4)

**Q: How do four clients share one engine?**
`@dsa-portal/core` has no HTTP or database dependency: loader, selector, hints, solutions and sandbox. The server,
the worker, the CLI and the desktop app (offline judging) all import it. Storage is an interface, with PostgreSQL and SQLite implementations.

**Q: How do you keep the API and the clients in step?**
`docs/openapi.yaml` is the source of truth. A contract test calls every registered route and validates the response
against the spec with Ajv, so code and spec cannot drift. There is one error shape (`{ error, message, statusCode, timestamp, path }`) and one
cursor format.

## 2. Sandbox (running untrusted code)

**Q: Why child_process + vm, not vm alone, worker_threads or isolated-vm?**
`vm` alone is not a security boundary (Node's docs say so), and an infinite loop blocks the host. `worker_threads` shares the
process, so a crash or `process.exit` hits the parent. `isolated-vm` is a native addon that must be rebuilt for every
platform and every Electron version. A child process gives an **OS-level kill switch and memory cap**, needs no native code,
and runs unchanged in Electron. (`docs/sandbox-decision.md`)

**Q: Walk me through the walls.**

1. A fresh `vm` context per test, built from `Object.create(null)`: no `require`, `process` or host objects. `eval`/`Function` and Wasm are off, and V8 stops each test at the timeout (promise jobs included, via `microtaskMode`).
2. A separate process: 64 MB heap, env holds only `PATH`, killed from outside on timeout, output capped, stderr dropped.
3. Node's permission model: the child can read only its own temp dir and the wrapper. No writes, no spawning, no worker threads.
4. A container (CR-024): non-root, read-only, no capabilities, pids/memory/CPU limits.

**Q: The classic escape `this.constructor.constructor('return process')()`?**
The context holds no host objects, so that constructor is the context's own `Function`. String code generation is
disabled, so it throws. There is a test for it in `core/__tests__/sandbox.test.ts`.

**Q: Can user code fake a "passed" verdict?**
No. The verdict is computed **on the host** by comparing the result with the expected output. User code never sees the
expected output (only inputs are written to the temp dir). Built-ins are captured before user code runs, so overriding
`JSON` or `toJSON` doesn't help.

**Q: Weaknesses?**
Node 20's permission model does not block **network** access. Reaching `net` would need a `vm` escape first, and the fix is `--network none` on
the container. The kernel is shared with the worker, so container-per-job or gVisor would be the next step. (`docs/threat-model.md`, residual risks)

## 3. Queue

**Q: The brief said Redis + BullMQ. Why PostgreSQL?**
The `submissions` row **is** the job, so saving a submission and enqueueing it are one insert and can never get out
of sync. It also means one service fewer to run. The cost: we built retries, leases, dead-lettering and metrics ourselves. Revisit at thousands of
jobs per second. (CR-005, `docs/queue-design.md`)

**Q: How do several workers avoid taking the same job?**
`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`. Each row goes to exactly one worker, and the others skip
it instead of waiting. A trigger fires `NOTIFY submission_queued`, so idle workers wake at once. Polling is the fallback.

**Q: A worker dies mid-job. What happens?**
It holds a **lease** (`locked_until`), renewed every lease/3. If the lease expires, another worker re-claims the row.
Every claim gets a new `lock_token`, and a worker must still hold the token to save. So a "zombie" worker that wakes up late
can't overwrite the newer result. The chaos script SIGKILLs a worker mid-job and checks there is exactly one result.

**Q: Exactly once?**
Delivery is at-least-once; the **effect** happens once. The `Idempotency-Key` unique index blocks duplicate POSTs, SKIP LOCKED blocks duplicate claims,
the `lock_token` blocks duplicate saves, and already-judged rows are skipped.

**Q: Poison pills and overload?**
Attempts are counted at claim time, so a job that crashes its worker every time ends up dead-lettered after 3 attempts, not in an endless loop.
Once 500 jobs are waiting, the API returns `429 QUEUE_FULL` with `Retry-After` (backpressure).

## 4. Real time

**Q: How do results reach the client?**
Socket.IO on the API server. The JWT is checked in the handshake, and each socket joins `user:<id>`. **Database triggers** call
`pg_notify` on every status change, whatever code path caused it. Every API instance `LISTEN`s and forwards to its own sockets,
which is the same fan-out as the Redis adapter, without Redis. Events fire only after commit. Payloads are just ids, so the client
re-reads over REST, and polling stays as the fallback because NOTIFY is not replayed.

**Q: Daily challenge with several workers, no duplicates?**
A deterministic pick per UTC day (sha256 of the date over the sorted slugs). `INSERT … ON CONFLICT DO NOTHING` means only one
insert wins, and its trigger sends `daily:new` exactly once. No locks, no leader election.

## 5. Database efficiency (the question in `text.txt`)

**Q: How did you make your database usage efficient?** Answer in this order:

1. **Partial indexes for the hot paths.** The queue claim scans only `WHERE status = 'queued'` (migration 002), stalled-job
   recovery only `status = 'running'` (003), and the leaderboard only `WHERE solved` (005). Claim cost stays flat however
   much history piles up, because judged rows are not in those indexes.
2. **Keyset (cursor) pagination, not OFFSET.** `OFFSET 10000` still reads and throws away 10,000 rows. A cursor `(created_at, id) < (…)`
   jumps straight in through an index, so page 1,000 costs the same as page 1, and inserts don't shift pages.
3. **Precomputed aggregates.** `user_problem_stats` keeps one row per user and problem (attempts, solved, first_solved_at),
   updated when a result is saved. Stats and the leaderboard read that table, not the whole submissions history.
4. **No polling load.** Workers and the realtime gateway are woken by `LISTEN/NOTIFY` instead of querying in a loop.
5. **A tuned connection pool** (`server/src/db/pool.ts`): bounded size, a 5 s statement timeout, idle connections reaped. Worker loops
   borrow a connection per query and hold none while the sandbox runs, so 10 loops fit in a 10-connection pool.
6. **One round trip where it matters:** the claim is a single `UPDATE … RETURNING`, and upserts use `ON CONFLICT`.
7. **Parameterised queries everywhere** (safe from SQL injection, and the driver sends values separately from the SQL).
8. **Measured, not guessed:** the load test showed the database was _not_ the bottleneck (the API accepted 100 submissions in ~140 ms).
   A "parallel reads" change measured flat, **so we reverted it**.

Be careful: `mv_leaderboard` (Person 2's materialized view) is used only in `scripts/benchmark-queries.ts`.
The live leaderboard aggregates `user_problem_stats`, with a `shortcut:` comment: precompute it if users grow into the hundreds of thousands.

## 6. Security

**Q: Main defences?**
JWT access tokens (15 min) with refresh rotation and reuse detection. The refresh token is an `HttpOnly`, `SameSite=Strict`, `Secure`
cookie scoped to `/api/v1/auth`. bcrypt passwords, with a dummy hash compared for unknown emails so that response timing doesn't reveal which accounts exist.
Rate limits, quotas counted in PostgreSQL (exact across instances), helmet-style headers, a CORS allow-list (closed in production
when unset), a 512 KiB body limit, zod on every input, parameterised SQL, owner checks (someone else's submission returns 404, not 403),
admin role checks, and an audit row with a hash of the code for every submission. Full STRIDE review: `docs/threat-model.md`.

**Q: What did your final security review find and fix?** (commit `aca4ea3`)

| Found                                                                                                                                                   | Fix                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Offline sync trusted the client's verdict.** One `POST /sync/push` with `passed: 10, total: 10` marked a problem solved and inflated the leaderboard. | Synced submissions are inserted as `queued` and re-judged by our worker. The client's verdict is ignored, and an existing row is never rewritten. |
| **The production seed created `admin@dsa.portal` / `password123`**, a password visible in the public repo.                                              | In production the demo accounts use `SEED_ADMIN_PASSWORD` or stay locked. Every start moves accounts still on the old hash off it.                |
| **`/metrics` was public on Render** (nginx hides it in Docker, but Render has no nginx).                                                                | `METRICS_TOKEN` Bearer check (constant-time compare). Render generates the value.                                                                 |

The principle to say: **never trust the client for anything that affects other users.** The server judges, the server ranks.
The trade-off: an offline solve counts on the leaderboard only after the worker re-judges it, a few seconds after sync.

**Q: Why not fix all `npm audit` findings?**
Every remaining advisory needs a **major** upgrade (Expo 51→58, zod 3→4, React Router 6→7). Most are mobile **build-time**
tools that never ship to the server. zod's memory issue is capped by the 512 KiB body limit, and its only unbounded arrays are on admin routes.
The React Router open redirect needs a user-controlled URL in `navigate()`, and ours comes from router state the app sets itself. A blind
`npm audit fix` actually **raised** the count (48 → 49, with a new critical), so we reverted it. Measure, don't assume.

## 7. Performance

**Q: How did you find the bottleneck?**
I asked the system one question at a time. Is the API the limit? No: it accepted 100 submissions in ~140 ms. Is the queue? No: it drained steadily.
Is judging? Yes, two ways: **2 judging loops on 10 cores**, and **a new Node process per test case** (~40 ms startup against <1 ms of user code).
Fix 1: one loop per CPU core (~2×). Fix 3: one child per submission with a fresh `vm` context per test (~3.7×). Together: 6.4×.

**Q: What did fix 3 cost?**
A memory bomb now ends the remaining tests of _that one submission_ (marked "Not run"). The verdict is the same (`error`). All the hostile tests still pass.

**Q: How does it scale?**
Workers: add processes or machines, and SKIP LOCKED spreads the work with no coordinator. Throughput is roughly linear until connections run out, then add PgBouncer.
API: stateless apart from the in-memory rate counters, so N instances can sit behind a load balancer (move the counters to Redis then). Realtime works across
instances because each one LISTENs. Database: read replicas for stats and the leaderboard, and partitioning `submissions` by month at very large sizes.

## 8. Testing, CI and teamwork

**Q: How do you know it works?**
Jest/Vitest across core, server, workers and the clients. Database tests hit a **real, migrated PostgreSQL**, not mocked SQL (in-memory stores are only for pure logic). There is a contract test
against OpenAPI, the sandbox has hostile samples, the queue has a chaos test, and the load test can be rerun. GitHub Actions runs lint → Prettier → build → migrations + seed →
all tests → Docker image builds.

**Q: Tell us about a real failure.**
After a teammate's PR merge, `main` went red: the merge kept **both copies** of `getPool`/`PoolMetrics` in `server/src/db/pool.ts`,
so the server didn't compile, and that also broke the Docker image and the Render deploy. I found it from the CI logs, ran every CI step
locally (including the Docker build), removed the duplicate, and confirmed the GitHub run went green. The lesson: protect `main` and require a green
CI run before merging.

**Q: How did three people avoid stepping on each other?**
Folder ownership. The OpenAPI contract was the source of truth. Changes to someone else's area went through `docs/CHANGE_REQUESTS.md`
(CR-001 … CR-029), and each person wrote a daily handover in `docs/handover/`.

## 9. If they ask "what would you do differently?"

- Protect `main` (required CI) from day 1. The red build came from a merge nobody checked.
- Treat **every** write path as a trust boundary from the start. The sync endpoint had a different author and skipped the rule the REST path followed.
- Container-per-job (`--network none`) or gVisor for judging. A warm pool of sandbox children to save the ~40 ms startup.
- Redis for shared rate-limit counters once there is more than one API instance.
- zod 4, Expo SDK upgrade, React Router 7.
