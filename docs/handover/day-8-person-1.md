# Handover: Day 8, Person 1 (security hardening)

## What was built

- **Rate limits** (`server/src/lib/rate-limit.ts`, hooks in `app.ts`): 300 req/min per IP on all of `/api/v1`, 120 req/min per signed-in user. Over the limit: `429 RATE_LIMITED` + `Retry-After`.
- **Execution quotas** (`submissions/routes.ts`): 10 submissions/min and 500/day per user, counted in PostgreSQL (`SubmissionQueue.nthNewestSince`, served by the existing `(user_id, created_at DESC)` index), so they hold across API instances. Over: `429 QUOTA_EXCEEDED` with an exact `Retry-After` (when the oldest submission in the window drops out). Idempotent replays use no quota.
- **helmet-style headers** on every response, **CORS allow-list** (`CORS_ORIGINS`) shared by REST and Socket.IO, **body limit** 512 KiB (`413`), `trustProxy` behind `TRUST_PROXY=true`, NUL characters in code → `400` (was a 500).
- **Reduced privileges for untrusted code**: every sandbox child now runs under Node's permission model (`--experimental-permission`): it may read only the wrapper and its own temp dir, may not write files, spawn processes or start worker threads. This is on top of the vm context, the 64 MB heap, 2 s timeouts and the env with only `PATH`. Container limits for the worker process (non-root, read-only, `cap_drop: ALL`, `pids_limit`, memory/CPU) are in **CR-024** for Person 2 (docker files are theirs).
- **Audit log**: each accepted submission writes `audit_log` (`submission.create`: user, submission id, problem, SHA-256 + length of the code, IP, time) through Person 2's `PostgresAuditRepository`. A failed audit write is logged, not shown to the user (the submission is already queued).
- **`docs/threat-model.md`**: STRIDE table with the file that implements each mitigation, residual risks, future work (container-per-job, gVisor) and the `npm audit` table.
- **npm audit**: Fastify 4 → 5.12.8, `@fastify/jwt` 8 → 10.2.7 (`fast-jwt` 6.3.6), `@fastify/cors` 9 → 11.4.3. 56 → 50 findings. The server/worker tree is clean except zod 3 (mitigated by the body limit). The rest is Expo/React Router client tooling: **CR-025** for Person 3.
- OpenAPI: 413 + 429 codes documented (CR-023). `.env.example`: `CORS_ORIGINS`, `RATE_LIMIT_IP_PER_MIN`, `RATE_LIMIT_USER_PER_MIN`, `SUBMIT_QUOTA_PER_MINUTE`, `SUBMIT_QUOTA_PER_DAY`, `TRUST_PROXY`.

## How to run

```bash
npm install && npm run build
npx jest server/__tests__/security.test.ts core/__tests__/sandbox.test.ts   # Day 8 security tests
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest --runInBand   # everything
npm audit --omit=dev
```

Try it by hand: send 11 `POST /api/v1/submissions` in a minute → the 11th is `429 QUOTA_EXCEEDED` with `Retry-After`.

## Security tests (what proves the limits work)

- `server/__tests__/security.test.ts`: per-IP limit, per-user limit across many IPs, per-minute and per-day quota with `Retry-After`, a replay that uses no quota, security headers, CORS allowed vs refused origin, 413, NUL → 400, the audit row's exact contents, and a failed audit write that still accepts the submission.
- `core/__tests__/sandbox.test.ts` › "Node permission model": the child's flags, and that those flags really block `readFileSync('/etc/hosts')` and `child_process`. All Day 3 hostile samples still pass under the new flags.

## For Person 2

- **CR-024:** worker container config (non-root, read-only + tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit`, `mem_limit`, `cpus`, no `JWT_SECRET`).
- `audit_log` now gets one row per submission. If it grows, add a retention job (e.g. 90 days).

## For Person 3

- **CR-023:** handle `429` by `error` code (`QUOTA_EXCEEDED`, `QUEUE_FULL`, `RATE_LIMITED`) and `Retry-After`. Set `CORS_ORIGINS` to the web app's origin in production.
- **CR-025:** Expo SDK / React Router upgrades clear the remaining audit findings. A test-order dependency in `person3-postgres.test.ts` (needs the `two-sum` seed).
- The Fastify 5 upgrade didn't need any change in your modules. All your tests pass.

## Known issues

1. Rate-limit counters live in each API instance's memory (`shortcut:` comment). Quotas are global.
2. Two simultaneous requests can both pass the quota check (1–2 extra per window).
3. Network access from a child that escaped the vm is not blocked by Node 20's permission model. Container `network_mode: none` for judging is future work (threat model, residual risk 1).
4. On a fresh database, `person3-postgres.test.ts` › "concurrent submissions" passes only when the e2e suite has seeded `two-sum` first (CR-025, item 3).

## Design decisions (for the viva)

- **Defence in depth for untrusted code:** the vm context (no host objects) is wall 1, a separate OS process with a heap cap, timeout and empty env is wall 2, and Node's permission model is wall 3: even a vm escape can't read files, write, or spawn. Containers per job would be wall 4 (future work).
- **Quotas in PostgreSQL, rate limits in memory:** quotas protect expensive CPU work and must be exact across instances, and the existing index makes them one indexed lookup. Rate limits are a cheap first filter, so per-instance counters are good enough.
- **Exact `Retry-After` from the n-th newest submission:** a sliding window with no extra table. The client knows exactly when the next slot opens.
- **Audit stores a hash, not the code:** the code already lives in `submissions`. The hash proves the row wasn't changed, and the audit table stays small.
- **Audit failure doesn't fail the request:** the submission is already committed, so failing would only make the client retry. The error log keeps the record instead.
- **Upgrade Fastify instead of documenting it:** v4 is end-of-life and had an auth-bypass advisory. The upgrade needed one type annotation in our code.
- **No `@fastify/helmet` / `@fastify/rate-limit`:** six headers and a 20-line counter don't justify two dependencies, and the code is easy to read and test.
