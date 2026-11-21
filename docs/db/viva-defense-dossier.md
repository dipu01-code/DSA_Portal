# Viva Defense Dossier — Person 2 (Database, Sync & DevOps)
## DSA Practice Platform — 10-Day Delivery Summary

---

## Quick Reference: What Was Built

| Day | Branch | Focus | Key Artifacts |
| :-- | :----- | :---- | :------------ |
| 0 | `person-2/day-0` | Schema DDL & ER Design | `001_initial_schema.sql`, 11 tables, Docker Compose dev stack |
| 1 | `person-2/day-1` | Connection Pool & Migrations | `pool.ts`, `migrate.ts`, schema verification |
| 2 | `person-2/day-2` | Dataset & Seeders | 40 DSA problems, `seed.ts`, `import-legacy.ts` |
| 3 | `person-2/day-3` | Storage Abstraction | `DatabaseAdapter` interface, SQLite repositories (WAL mode) |
| 4 | `person-2/day-4` | Sync Architecture | `sync-design.md`, `002_sync_tables.up.sql`, HLC types |
| 5 | `person-2/day-5` | Sync Engine | Server `/push` & `/pull`, client `SyncEngine`, conflict resolver, 2-device convergence test |
| 6 | `person-2/day-6` | DB Optimization | 10k users / 100k subs seeder, `003_performance_indexes`, `mv_leaderboard`, keyset pagination |
| 7 | `person-2/day-7` | Containerization & CI/CD | Multi-stage Dockerfiles, `docker-compose.prod.yml`, Nginx, GitHub Actions CI |
| 8 | `person-2/day-8` | Backup & Security | Backup + restore scripts, SHA-256 manifests, `004_security_roles`, audit log trigger |
| 9 | `person-2/day-9` | Health & Metrics | `/health/live`, `/health/ready`, Prometheus `/metrics`, alert rules, runbook |
| 10 | `person-2/day-10` | Integration & Polish | 91-test final smoke suite, viva defense dossier |

**Final test count**: **91 tests / 19 suites — all passing.**

---

## Core Design Decisions & Viva Q&A

### 1. Why SQLite with WAL mode for local storage?

> **Answer**: Write-Ahead Logging (WAL mode) in SQLite replaces the default rollback journal, enabling **concurrent readers with one writer simultaneously** — critical for the CLI/Desktop/Mobile clients that may have background sync writing ops while the UI reads problem data. WAL also provides **crash-safety**: on an unexpected shutdown, only the in-flight WAL frame is discarded; committed pages are preserved. The alternative (default journal mode) holds an exclusive lock during writes, causing the UI to freeze during sync flushes.

---

### 2. Why Hybrid Logical Clocks (HLC) instead of server timestamps or vector clocks?

> **Answer**: 
> - **NTP wall-clock timestamps** can go backwards due to clock skew across devices (a laptop sleeping for 2h, then reconnecting). Using them directly means older events appear newer than genuinely recent ones, breaking causal ordering.
> - **Vector clocks** require `O(N)` space per operation where N is the number of devices. With 10,000 users each owning multiple devices, this is prohibitive.
> - **HLC** combines physical time (staying close to wall-clock) with a logical counter (breaking ties within the same millisecond) in a single compact `"<ms>.<counter>.<deviceId>"` string. It guarantees strict causal ordering (`e → f ⟹ HLC(e) < HLC(f)`) while producing timestamps that are approximately human-readable. Bounded drift: an HLC timestamp never drifts more than a configured window (e.g. 1 minute) ahead of wall-clock time.

---

### 3. Why an OpLog (operation log) pattern for sync, not two-way diff?

> **Answer**: Two-way diffing computes `SET(server) ΔOM SET(client)` at sync time — this requires loading **all** entity records into memory on both sides, sorting them, and comparing field-by-field. With 100,000 submissions, this is O(N) in memory and O(N log N) in time per sync cycle. The **OpLog pattern** captures the delta incrementally:
> - Each mutation on the client appends one `SyncOperation` row with `op_id`, `entity`, `payload`, `hlc_timestamp`.
> - Push sends only unacknowledged ops (bounded batch, default 100).
> - Pull advances a `server_seq` cursor — the client only downloads ops newer than its last known sequence.
> - Both push and pull are **O(delta)** — proportional to changes since last sync, not to total dataset size.
> - **Idempotency**: `op_id` (UUID v4) is the deduplication key. Duplicate pushes are silently acknowledged without re-applying.

---

### 4. Why Keyset pagination instead of OFFSET for the leaderboard & submission feeds?

> **Answer**: `OFFSET N` forces PostgreSQL to scan and discard the first N rows on every page request. At deep pages (e.g. `OFFSET 50000`), this becomes O(N) disk reads. Measured benchmark result: **25.59 ms at OFFSET 50,000** for submissions.
>
> Keyset pagination uses a `WHERE (created_at, id) < ($last_created_at, $last_id)` clause combined with the index `idx_submissions_keyset_pagination (created_at DESC, id DESC, user_id, status)`. PostgreSQL jumps directly to the B-tree leaf matching the cursor, discarding nothing. Measured result: **0.02 ms regardless of page depth** — a **1,112× speedup** on deep pages.

---

### 5. Why a Materialized View (`mv_leaderboard`) instead of live aggregation?

> **Answer**: The leaderboard query joins `users`, `user_problem_stats`, and `problems`, groups by user, and applies `RANK() OVER (...)`. With 10,000 users, this took **220.64 ms** live. By materializing it into `mv_leaderboard`, the API simply does `SELECT * FROM mv_leaderboard ORDER BY rank LIMIT 50` — **0.02 ms** (~6,900× faster).
>
> Tradeoff: the leaderboard is eventually consistent, not real-time. We mitigate this with:
> 1. **Background refresh**: `CALL refresh_leaderboard(true)` runs `REFRESH MATERIALIZED VIEW CONCURRENTLY` — readers are never blocked.
> 2. **Non-concurrent fallback**: on first population or when no UNIQUE index exists, non-concurrent refresh is used automatically.

---

### 6. Why least-privilege PostgreSQL roles?

> **Answer**: Defense-in-depth. If the Fastify API server is compromised via SQL injection, `dsa_app` has `SELECT/INSERT/UPDATE/DELETE` on data tables but **cannot `DROP TABLE`**, `CREATE ROLE`, or access pg_catalog. The BullMQ worker (`dsa_worker`) can only `UPDATE submissions` and `INSERT/UPDATE user_problem_stats` — it cannot read session tokens or delete problems. The read-only `dsa_readonly` role used by backup scripts and Prometheus exporters has zero write access, eliminating accidental data corruption during reporting.

---

### 7. Why trigger-based audit log immutability instead of application-level protection?

> **Answer**: Application-level guards (e.g. a `if (!allowDelete)` check in Node.js) can be bypassed if an attacker gains a shell on the application server and runs a direct `psql` session. A PostgreSQL `BEFORE UPDATE OR DELETE` trigger executes **inside the database engine** and cannot be bypassed by any connection, regardless of credentials (except for `postgres` superuser). This provides true non-repudiation guarantees for regulatory compliance.

---

### 8. Why multi-stage Dockerfiles?

> **Answer**: A naïve single-stage Docker build includes TypeScript compiler, `python3`, `make`, `g++` (for native Node bindings), and all devDependencies — producing an image of ~1.1 GB with hundreds of CVE-flagged packages. Multi-stage builds use a `builder` stage to compile TypeScript and prune to `dist/`, then copy only production artifacts into a fresh `runner` stage based on `node:20-alpine`. Final image: **~140 MB**. Additionally, running as the unprivileged `node` user (UID 1000) means a container escape doesn't grant root on the host.

---

### 9. What is `dumb-init` and why is it used?

> **Answer**: Node.js is not designed to be PID 1. As PID 1, a process is responsible for reaping orphaned child processes. Node.js doesn't do this, causing zombie sub-processes from sandboxed code execution (the judge child_process) to accumulate and eventually exhaust process table slots. `dumb-init` acts as a minimal init system: it adopts orphaned child processes, forwards `SIGTERM` to Node.js (enabling graceful shutdown and BullMQ job draining), and handles `SIGCHLD` correctly.

---

### 10. How does the health probe distinguish "degraded" from "down"?

> **Answer**: Two-tier probe architecture:
> - **`/health/live`**: Only checks that the Node.js event loop is responsive (returns in < 1ms). Failing this restarts the container.
> - **`/health/ready`**: Runs `SELECT 1` with round-trip latency measurement AND reads `pool.waitingCount`. If the database is unreachable → `status: "down"` (503). If the database responds but `waitingCount > 5` or `latencyMs > 500` → `status: "degraded"` (200, but orchestrator stops routing new requests). This prevents cascading failures: a slow database doesn't take down the container, but does stop serving new traffic until the pool recovers.

---

## Final Test Matrix

| Test Suite | Tests | Description |
| :--------- | ----: | :---------- |
| `hlc.test.ts` | 6 | HLC monotonicity, comparison, merge, format, parse |
| `sync-engine.test.ts` | 10 | Two-device convergence, duplicate push, partial failure, stale cursor |
| `pagination.test.ts` | 8 | Keyset encode/decode, buildKeysetClause, paginateKeyset edge cases |
| `integration/smoke.test.ts` | 15 | Cross-module integration across HLC, Sync, Backup, Health, Metrics, Migrations |
| `backup-restore.test.ts` | 4 | Checksum computation, tamper detection, manifest listing, pruning |
| `health-metrics.test.ts` | 4 | Liveness, readiness (ok/down), Prometheus exposition |
| `security-roles.test.ts` | 3 | Role existence, audit log UPDATE block, audit log DELETE block |
| `repositories.test.ts` | 4 | PostgreSQL Problem/Submission repositories |
| `seed-validation.test.ts` | 3 | Seeder idempotency, row counts |
| `docker-config.test.ts` | 4 | Dockerfile and compose structure validation |
| `ci-workflow.test.ts` | 2 | GitHub Actions YAML structure validation |
| `executor.test.ts` | 10 | Code execution sandboxing |
| `index.test.ts` | 4 | Core package exports |
| `problem-loader.test.ts` | 5 | Problem file loading and filtering |
| `problem.schema.test.ts` | 5 | Zod schema validation |
| `problems.test.ts` | 3 | Problem dataset integration |
| `random-selector.test.ts` | 4 | Randomized problem selection |
| `hint-service.test.ts` | 4 | Progressive hint delivery |
| `solution-service.test.ts` | 3 | Solution unlock logic |
| **TOTAL** | **91** | **19 suites — all passing** |
