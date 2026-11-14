> **Update (merge with `main`, Day 10):** Person 1's leaderboard, daily challenge and Socket.IO gateway replaced the fork's routes below (CR-021/CR-022 on `main`). The cache now wraps their stores (`server/src/cache/cached-stores.ts`; wiring = CR-032), `ui-core/src/realtime.ts` uses the handshake token and `submission:finished` / `leaderboard:updated` / `daily:new`, and migration 004 is now `006_session_families`.

# Day 7 — Person 3: Redis caching, real-time clients, leaderboard and daily challenge (+ open CRs closed)

## What was built

**Caching (`server/src/cache`)** — design, keys, TTLs and trade-offs in `docs/design/cache-design.md`.

- `Cache` helper: cache-aside, TTL + 0–10 % jitter, stampede protection (in-process single flight + Redis `SET NX` lock with bounded waiting), generation keys for list invalidation, negative caching, hit/miss/error counters, pass-through when Redis is down or `REDIS_URL` is unset.
- `CachedProblemRepository` wraps the problem repository (lists 300 s, detail 600 s); admin create/update/delete invalidate.
- Leaderboard (30 s, invalidated by the worker after every judged submission) and daily challenge (300 s). User-private data is never cached.
- `GET /metrics` (Prometheus text): `dsa_cache_requests_total{result}`, `dsa_cache_errors_total`.

**Endpoints the clients needed (Person 1's folders, CR-021 on the fork, now CR-028):** `GET /api/v1/leaderboard` (solved, then score; ties share a rank; cursor paging) and `GET /api/v1/daily-challenge` (admin-pinned problem for today, else a daily rotation).

**Clients**

- `ui-core/src/realtime.ts`: Socket.IO client (`auth:join`, `submission:result`, `leaderboard:update`). With a live socket the submission poll becomes a 5 s safety net that a pushed result cuts short; without one it is the normal 750 ms polling. Hooks: `useSubmissionStatus()` (adds `live`), `useDailyChallenge()`, `useLeaderboard()` (now reloads on `leaderboard:update`, has `reload`).
- Web + desktop: Leaderboard page (nav link), daily-challenge card on Practice, "live / checking every second" note while judging; Vite proxies `/socket.io`; desktop CSP allows the API's `ws://`.
- Mobile: Leaderboard tab, daily-challenge card on Practice, live note on the problem screen.

**Open change requests closed (with the user's approval, owners please review):** CR-012 (seed password), CR-014 (`sessions.family_id` + `revoked_at`, migration 004; reuse now revokes only the stolen login family), CR-015 (`ProblemRepository.delete`), CR-017 (`save()` calls `updateStatsOnSubmission`). CR-010/016/018 marked done. The desktop app now judges offline with its own Electron binary (CR-018): verified with no Node on `PATH`.

## How to run

```bash
redis-server --port 6379                                        # or: npm run db:up (docker compose has redis)
npm run db:migrate && npm run db:seed                            # migration 004; seed users can log in (password123)
REDIS_URL=redis://localhost:6379 npm run dev:server
npm run build -w workers && REDIS_URL=redis://localhost:6379 node workers/dist/main.js
curl localhost:3000/metrics                                      # hit/miss counters

REDIS_TEST_URL=redis://localhost:6379 TEST_DATABASE_URL=postgresql://postgres@localhost:5432/dsa_portal_test npx jest
npm test -w ui-core   # 35 (incl. a real Socket.IO server)    npm test -w web   # 5    npm test -w mobile   # 16
```

Verified on the real stack (PostgreSQL + Redis + worker): seed login 200; leaderboard miss → hit; a judged submission bumped the leaderboard generation and the next read showed the new solver; daily challenge served and cached.

## Endpoints / events others can use

|                                        |                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/leaderboard?limit&cursor` | public, `{ data: LeaderboardEntry[], nextCursor }`                                                                      |
| `GET /api/v1/daily-challenge`          | bearer, `{ date, problemId, problem }`                                                                                  |
| `GET /metrics`                         | Prometheus text (cache)                                                                                                 |
| Socket.IO (clients expect)             | emit `auth:join {token}`; receive `submission:result`, `leaderboard:update` (CR-022 on the fork, now CR-029, withdrawn) |

Cache helper usage for Person 1: see "Usage for Person 1" in `docs/design/cache-design.md`.

## Known issues

1. **No Socket.IO server yet** (Person 1's realtime module). Clients connect, fail quietly and keep polling, so results still arrive; `live` stays false until the server exists. CR-022 (now CR-029) for `submissionId` in `submission:result`.
2. **Mobile notifications (expo-notifications) dropped**, as the pack allows when time is short: it needs a native rebuild of the dev client. Next step: daily-challenge + streak reminders as local notifications.
3. Leaderboard paging is an opaque offset (fine for a 30 s cached board); "Load more" isn't shown yet (first 50).
4. Login throttling is still per process; it can move onto the same Redis next.
5. Docker on this machine can't create containers (read-only storage), so Redis was installed with Homebrew for the tests.

## Design decisions (viva)

- **Cache-aside, PostgreSQL stays the truth:** Redis only holds copies, so losing Redis loses speed, never data.
- **Generations instead of deleting keys:** one `INCR` invalidates every list or leaderboard page at once; no `KEYS`/`SCAN`, old keys expire.
- **Two-level stampede protection:** single flight per process plus a short Redis lock across processes, so one hot key expiring costs one DB query, not hundreds.
- **TTL jitter:** keys written together don't expire together.
- **Availability over consistency (CAP):** if Redis is unreachable we answer from PostgreSQL; the worst case is data up to one TTL old, which is why private data is never cached.
- **Socket push as an accelerator, polling as the guarantee:** the client works with or without the socket, which is also what makes it safe to ship before the server side exists.
- **Refresh families (CR-014):** a replayed refresh token now logs out only the stolen login, not every device of the user.
