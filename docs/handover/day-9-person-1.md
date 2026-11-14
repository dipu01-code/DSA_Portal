# Handover: Day 9, Person 1 (integration and load testing)

## What was built

- **Full-flow test** `workers/__tests__/full-flow.e2e.test.ts`. Every part is a real process: it builds and starts `server/dist/index.js` and `workers/dist/main.js` against PostgreSQL, then works over HTTP and Socket.IO only: **register → login → random problem (Arrays/Easy) → solution locked (403) → submit → result by polling AND by socket (`queued → running → finished`, in order) → stats updated (attempted 1, solved 1, topic counted) → solution unlocked → audit row written**. It also checks the per-user quota through PostgreSQL (`429 QUOTA_EXCEEDED` + `Retry-After`) and the security headers from the real server.
- **Load test** `workers/scripts/load-test.ts` (`npm run load -w workers`): 100 concurrent submissions from 100 users. Reports p50/p95/p99 for accept and end-to-end (DB timestamps), throughput and error rate.
- **Bottlenecks and fixes** (details: [`docs/load-test-report.md`](../load-test-report.md)):
  1. Worker `WORKER_CONCURRENCY` now defaults to the CPU count (was 2).
  2. Tried running the accept path's reads in parallel: no measurable gain, so it was **reverted**.
  3. **One sandbox child per submission** instead of one per test case (fresh vm context per test, V8 per-test timeout, results streamed per test).
  - **Result:** end-to-end p50 6.1 s → 1.0 s, p95 12.7 s → 1.7 s, throughput 7.5 → 47.8 submissions/s, 0% errors.
- Coverage scope in `jest.config.js` excludes Person 2's `core/src/storage` and `core/src/sync` (also excluded from core's build, CR-020). Person 1's core: 96.7% statements, 84% branches.
- **CI:** `.github` is Person 2's folder. The ready-to-use workflow (PostgreSQL service, build, `jest --runInBand`, client tests) is in **CR-026**.

## How to run

```bash
npm install && npm run build
createdb -U postgres dsa_portal_test      # once
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest --runInBand   # includes full flow
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest full-flow      # just the flow
DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npm run load -w workers      # load test
```

`.env.example`: `WORKER_CONCURRENCY` is now empty (= one loop per core).

## For Person 2

- **CR-026:** please add `.github/workflows/ci.yml` (text in the CR). The full flow needs only PostgreSQL.
- **CR-027:** the seeded users' hash in `server/src/db/seed.ts` is not a bcrypt hash of `password123` (checked with `bcrypt.compare` → false), so `student@dsa.portal` / `admin@dsa.portal` can't log in. Please regenerate it (`bcrypt.hash('password123', 10)`). The README and demo script register a fresh user for now.
- Query timings: the accept path makes ~12 round trips, and the problem lookup is 4 of them (problem, test cases, hints, solution). It's fine at ~700 accepts/s. If it ever matters, a `findSummary(id)` that loads only the row would help.

## For Person 3

- The sandbox API is unchanged (`submitCodeSandbox` / `submitCodeSandboxAsync`, same result shape). It now starts one process per submission, so the desktop's offline judging is ~4–5× cheaper too. A crash in one test marks the later tests `Not run: the sandbox stopped at an earlier test`. Show that text as is.

## Known issues

1. Load-test numbers come from a busy laptop (load average 8–34 from other apps). Every row is a median of 3–5 runs, and the raw runs are in the report.
2. With API and worker on one machine, the worker now takes all cores, so accept latency rose by ~55 ms under the burst. Run workers on their own hosts or set `WORKER_CONCURRENCY` lower when sharing a box.
3. CI is not running until CR-026 is merged.

## Design decisions (for the viva)

- **Measure, then fix:** three fixes tried, two kept. The parallel-reads change looked right on paper but measured flat, so it was reverted rather than kept as "optimisation".
- **Batch tests in one process, isolate them with contexts:** Node startup (~40 ms) dwarfed the user's code (<1 ms), so 5 starts per submission wasted ~95% of judging CPU. Fresh contexts plus V8 timeouts keep tests independent. The process is still the security boundary.
- **Concurrency = cores:** each judging loop is one CPU-bound child, so one loop per core uses the machine without oversubscribing.
- **End-to-end measured from the database:** `created_at → judged_at` is exact and independent of how fast the load generator polls.
- **Full flow uses the built artifacts:** it runs exactly what production runs (`node server/dist/index.js`), so build, config and wiring bugs show up, not just logic bugs.
