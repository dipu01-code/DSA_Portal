# Demo script: submit → live feedback (5 minutes, Person 1)

**Goal:** show that a submission goes API → queue → separate worker → sandbox → result, that the browser hears about
each step live, and that hostile code and overload are contained.

## Before the demo (10 min earlier)

```bash
npm run db:up && npm run build && npm run db:migrate && npm run db:seed
SUBMIT_QUOTA_PER_MINUTE=100 npm run start -w server        # terminal A (higher quota so the demo never trips it)
WORKER_METRICS_PORT=9464 npm run start -w workers          # terminal B
npm run dev -w web                                         # terminal C, http://localhost:5173
```

- Register a demo user in the web app (the seeded `student` password doesn't work yet, CR-027), log in, and leave it on the problem page.
- Open `http://localhost:3000/docs` in a second tab, and a terminal with `curl -s localhost:9464/metrics | grep dsa_queue_` ready.
- Arrange the windows: browser left, terminals A and B right (the worker log shows each job).

## 0:00–0:30 Context

**Say:** "One engine, four front ends. I own the backend: the REST API, the job queue and workers, the sandbox
that runs untrusted JavaScript, real-time events, the leaderboard and daily challenge, and security."
**Show:** the component diagram in `docs/architecture.md` (or `docs/report/part-1.md`, section 1).

## 0:30–1:45 Submit → live feedback (the main path)

1. Pick **Arrays / Easy → Two Sum**. Paste a correct solution and press **Submit**.
2. **Point at:** the status going _queued → running → judged_ in the UI. **Say:** "The API answered `202` in a few
   milliseconds. It only saved a row. A separate worker process claimed it with `SKIP LOCKED`, ran 5 tests in one
   sandboxed child process (a fresh vm context per test), and saved the result. A database trigger turned each status change into a
   Socket.IO event for my user only."
3. **Show:** terminal B's log line for the job, then the per-test results in the UI (5/5).
4. Submit a **wrong** answer (`return [0, 0]`). **Show:** failed tests with expected vs actual.

## 1:45–2:45 Hostile code is contained

Submit each one and show the verdict:

| Code                                                                              | Verdict               | Say                                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `function solve(){ while(true){} }`                                               | timeout               | "2 s per test; the child is killed, the worker carries on."                                                                         |
| `function solve(){ return require('fs').readFileSync('/etc/passwd','utf8') }`     | error                 | "No `require` in the sandbox. Even after a vm escape, Node's permission model blocks reading any file outside the test's temp dir." |
| `function solve(){ const a=[]; while(1) a.push(new Array(1e6)) }`                 | error (out of memory) | "64 MB heap cap per child."                                                                                                         |
| `function solve(){ return this.constructor.constructor('return process')().env }` | error                 | "The vm context has no host objects, and code generation from strings is off."                                                      |

**Say:** "Four walls: vm context, separate process with limits, Node permission model, and (CR-024) a locked-down container."

## 2:45–3:30 Reliability

**Show (terminal):** `npm run chaos -w workers` (≈20 s; it starts its own workers): "It SIGKILLs a worker mid-job. Another worker
re-claims it when the lease expires; the fencing token stops the dead one from saving; the user gets exactly
one result." Point at `PASS` at the end.
Or, if time is short, show `curl -s localhost:9464/metrics | grep dsa_queue_`: "waiting, active, failed, and a
job-duration histogram, ready for Prometheus."

## 3:30–4:15 Scale and limits

**Show:** `docs/load-test-report.md`, the before/after table. **Say:** "100 concurrent submissions: the API accepts them in
milliseconds and stays fast, because judging is async. We found the bottleneck: one Node start per test case was ~95%
of judging CPU, and the worker used 2 of 10 cores. Fixing both took end-to-end p95 from 12.7 s to 1.7 s and throughput from
7.5 to 48 submissions a second. One 'fix' measured flat, so we reverted it."
**Show (optional):** 11 quick submits in a row → `429 QUOTA_EXCEEDED` with `Retry-After`.

## 4:15–5:00 Docs, design and close

**Show:** `http://localhost:3000/docs` (Redoc from `openapi.yaml`; a contract test fails if code and spec drift).
**Say:** "Trade-offs I'd defend: PostgreSQL as queue and event bus instead of Redis+BullMQ (one service fewer,
transactional with the data; we'd swap it at around thousands of jobs per second). One process per submission with a
fresh context per test (strong isolation, one ~40 ms Node start). Rate limits in memory but quotas in the database. Next: container-per-job or gVisor, and Redis
for counters when we run several API instances."
**Close:** the leaderboard tab updating (`leaderboard:updated`) after the correct submission.

## If something breaks

- **Nothing moves after Submit:** the worker isn't running (terminal B). Restart it. The job is still queued and gets picked up.
- **No live updates:** the UI keeps polling as a fallback, so the result still appears within a couple of seconds.
- **`429`:** the quota. You started the server without `SUBMIT_QUOTA_PER_MINUTE=100`.
