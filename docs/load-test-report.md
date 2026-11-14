# Load test report (Day 9, Person 1)

## Setup

- **Tool:** `workers/scripts/load-test.ts` (`npm run load -w workers`). Plain `fetch`, no k6/autocannon dependency (neither was installed, and the script needs database access to create users and read exact timestamps).
- **Load:** 100 submissions fired at once, **one per user** (100 users, as 100 people submitting together), all a correct Two Sum (5 test cases).
- **System under test:** the real built API (`server/dist/index.js`) and 1 worker process (`workers/dist/main.js`), PostgreSQL 16, all on one 10-core Apple Silicon laptop together with the load generator. Quotas, rate limits and backpressure were raised for the test so they don't reject the burst.
- **Metrics:**
  - _accepted_: `POST /submissions` → `202`, measured by the client.
  - _end-to-end_: `submissions.created_at` → `judged_at`, from the database, so polling adds no error.
  - _throughput_: judged submissions ÷ wall time.
  - _error rate_: non-202 answers + submissions not judged as 5/5 passed.
- **Noise:** the laptop was also running an Android emulator, iOS simulators and a disk indexer. The load average was ≈8 for the "before" runs but ≈28–34 for most "after" runs, so the improvement below is **understated**. Each row is the **median of 3–5 runs**. Raw runs are at the end.

## Before → after

| Version                                        | accepted p50 / p95 / p99 (ms) | end-to-end p50 / p95 / p99 (ms)   | throughput (subs/s) | errors |
| ---------------------------------------------- | ----------------------------- | --------------------------------- | ------------------- | ------ |
| **Before** (Day 8 code)                        | 133 / 136 / 137               | 6139 / 12688 / 13191              | 7.5                 | 0%     |
| Fix 1 only: worker concurrency = CPU cores     | 198–240 (2 runs)              | 3194–4325 / 5279–8142 / 5405–8268 | 11.6–17.7           | 0%     |
| Fix 3 only: one sandbox process per submission | 178 / 185 / 188               | 1654 / 3204 / 3357                | 27.6                | 0%     |
| **After** (fix 1 + fix 3)                      | 189 / 201 / 202               | **1017 / 1702 / 1730**            | **47.8**            | 0%     |

**End-to-end p50 is 6× faster (6.1 s → 1.0 s), p95 is 7.5× faster (12.7 s → 1.7 s), and throughput is 6.4× higher (7.5 → 47.8 submissions/s), with no errors.**

## Bottlenecks found

Questions asked of the system, with what the data showed:

1. **Is the API the limit?** No. Accepting all 100 takes about 140 ms in total (≈700 requests/s). The p50 accept time is just the burst queuing up. Each POST makes ~12 round trips (quota ×2, queue depth, problem with test cases/hints/solution, insert transaction, audit) through a 10-connection pool, and that holds up fine.
2. **Is the queue the limit?** No. `dsa_queue_waiting` drains steadily, and claims use `SKIP LOCKED` with NOTIFY wake-ups, so there's no polling delay.
3. **Is judging the limit? Yes, two ways.**
   - **The worker ran only 2 judging loops on 10 cores** (`WORKER_CONCURRENCY` default 2). Most of the CPU sat idle while 100 jobs waited.
   - **Each test case started its own Node process** (≈40 ms of CPU for startup against well under 1 ms for the user's code). With 5 tests per problem, ~95% of judging CPU went to starting Node.

## Fixes

| #   | Fix                                                                                                                                                                                                                                                                                                             | Result                                                                                                    | Kept?                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Worker default `WORKER_CONCURRENCY` = `os.availableParallelism()` (was 2). Loops borrow pool connections per query, so 10 loops fit the default pool.                                                                                                                                                           | ~2× throughput                                                                                            | yes                                           |
| 2   | Run the accept path's independent reads in parallel (quota, queue depth, problem lookup)                                                                                                                                                                                                                        | **no measurable change** (accepted p50 118–139 ms vs 118–142 ms): the burst queues on the pool either way | **no, reverted** (complexity without benefit) |
| 3   | **One sandbox child per submission:** all test cases run in one Node process, each in a fresh vm context with V8's own per-test timeout (`timeout` + `microtaskMode: 'afterEvaluate'`). The host still kills the process as a backstop. Results stream one line per test, so a crash keeps the earlier results. | ~3.7× throughput alone, 6.4× together with fix 1                                                          | yes                                           |

**Fix 3's security check:** every Day 3 hostile sample and Day 8 permission test still passes, plus new tests. Every test sees a fresh global scope, a timeout or crash in one test doesn't hide the others' results, an endless promise chain is stopped, and user code can't replace the runner. The trade-off: a memory bomb now ends the remaining tests of _that submission_ (marked "Not run"). The verdict is the same (`error`).

**Why accept latency rose (133 → 189 ms p50):** the worker now uses all 10 cores, and in this test it shares them with the API, PostgreSQL and the load generator. In a deployment the workers run on their own machines (or with CPU limits, CR-024), so the API keeps its cores.

## What's next (not done)

- **Worker hosts:** scale out by adding worker processes or machines. Claims are `SKIP LOCKED`, so throughput grows roughly linearly until PostgreSQL connections run out (then PgBouncer, see queue-design.md).
- **A warm process pool** (pre-started sandbox children) would cut the remaining ~40 ms Node start per submission. It adds lifecycle complexity, so only if p50 matters below ~1 s under load.
- **Accept path:** if it ever matters, cache problem existence per instance (problems rarely change) to drop four of the ~12 round trips.

## Raw runs (`| label | accepted p50/p95/p99 | e2e p50/p95/p99 | subs/s | errors |`)

```
load≈8   | before (cold, 1st) | 204 / 211 / 211 | 6122 / 11462 / 11930 | 8.29 | 0.0% |
load≈8   | before    | 133 / 136 / 137 | 6676 / 13915 / 14437 | 6.77 | 0.0% |
load≈8   | before    | 118 / 123 / 131 | 6139 / 11596 / 12038 | 8.16 | 0.0% |
load≈8   | before    | 142 / 148 / 149 | 5935 / 12688 / 13191 | 7.52 | 0.0% |
load≈8   | fix2-only | 130 / 133 / 133 | 5948 / 11378 / 11850 | 8.35 | 0.0% |
load≈8   | fix2-only | 118 / 122 / 123 | 6163 / 11513 / 11968 | 8.17 | 0.0% |
load≈8   | fix2-only | 139 / 149 / 150 | 6511 / 12413 / 12899 | 7.54 | 0.0% |
load≈8   | fix1+fix2 | 358 / 365 / 366 | 2821 / 4420 / 4497 | 19.88 | 0.0% |
load≈15  | fix1-only | 240 / 248 / 249 | 4325 / 8142 / 8268 | 11.59 | 0.0% |
load≈15  | fix1-only | 198 / 211 / 212 | 3194 / 5279 / 5405 | 17.7 | 0.0% |
load≈34  | fix1+fix3 | 189 / 201 / 202 | 606 / 1060 / 1067 | 79.55 | 0.0% |
load≈34  | fix1+fix3 | 171 / 195 / 196 | 1333 / 1925 / 1972 | 46.36 | 0.0% |
load≈34  | fix3-only | 157 / 166 / 166 | 1500 / 2797 / 2902 | 31.18 | 0.0% |
load≈30  | fix1+fix3 | 234 / 252 / 260 | 2852 / 3358 / 3371 | 27.51 | 0.0% |
load≈30  | fix3-only | 198 / 203 / 209 | 1986 / 3761 / 3949 | 23.5 | 0.0% |
load≈30  | fix1+fix3 | 168 / 187 / 188 | 898 / 1536 / 1560 | 57.9 | 0.0% |
load≈30  | fix3-only | 249 / 261 / 273 | 1807 / 3166 / 3312 | 28.11 | 0.0% |
load≈28  | fix1+fix3 | 205 / 295 / 301 | 1017 / 1702 / 1730 | 47.78 | 0.0% |
load≈28  | fix3-only | 125 / 131 / 131 | 1481 / 3241 / 3401 | 27.06 | 0.0% |
```

Reproduce: `npm run build && DATABASE_URL=… npm run load -w workers` (after) and `WORKER_CONCURRENCY=2 …` (fix 3 only).
