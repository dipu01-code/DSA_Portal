# Handover: Day 7, Person 1

## What was built

- **Socket.IO gateway** on the API's HTTP server. It checks the JWT in the handshake (`auth: { token }`) and puts each socket in room `user:<id>`. Events: `submission:queued`, `submission:running`, `submission:finished`, `leaderboard:updated`, `daily:new`. All names and payloads are in [`/docs/websocket-events.md`](../websocket-events.md).
- **Events come from database triggers** (migration `005_realtime_events`): every submission status change, a fully passing submission, and a new daily challenge call `pg_notify`. Each API instance LISTENs and forwards to its own sockets, so it works with several instances without Redis (CR-021).
- **`GET /api/v1/leaderboard?period=week|all`** (public): keyset pagination, ranked by problems solved, then who reached that count first, then user id. `totalScore` = Easy 1, Medium 2, Hard 3 per solve.
- **`GET /api/v1/daily-challenge`**: one problem per UTC day, the same for everyone (deterministic pick, saved in `daily_challenges`). The worker creates it just after each UTC midnight, replacing a BullMQ repeatable job. Creating the row announces `daily:new` once.
- OpenAPI updated (`period`, 400, 401); contract cases added; `architecture.md` sequence diagram updated; curl and socket examples in `api-examples.md`.

## How to run

```bash
npm install && npm run build && npm run db:migrate     # applies 005
npm run start -w server     # REST + Socket.IO on PORT (3000)
npm run start -w workers    # judges submissions + creates the daily challenge
```

Tests: `npx jest` (no database: ranking, paging, daily pick, contract). With `TEST_DATABASE_URL=…` it adds the real-time end-to-end test: two sockets, a real submission judged by the separate worker process, events in order and only for the submitter, `leaderboard:updated` and a single `daily:new` for both.

## For Person 3 (clients)

- **Before merging your fork's Day 7, see CR-022:** drop your copies of the leaderboard/daily routes (they're on `main` now), wrap `main`'s stores with your Redis cache, switch `realtime.ts` to the events below, and renumber `004_session_families` to `006`.
- Connect: `io(API_URL, { auth: { token: accessToken } })`. On `connect_error` with message `UNAUTHORIZED`: refresh the token, set `socket.auth`, reconnect.
- On `submission:finished` for the id you're waiting on, stop polling and fetch `GET /submissions/{id}` for per-test results. **Keep polling as the fallback** (missed events aren't replayed).
- `leaderboard:updated` and `daily:new` mean "refetch". Please **cache** `GET /leaderboard` (key: `period` + `cursor` + `limit`) and `GET /daily-challenge` (key: UTC date; it's the same for everyone until midnight UTC) in your Redis/HTTP cache, and use these two events to invalidate (your Day 7 task).
- Day 1's draft events `auth:join` / `submission:result` / `leaderboard:update` are replaced by the names in the Day 7 brief. Your unmerged `ui-core/src/realtime.ts` (fork) still uses the draft: switch it to the handshake `auth: { token }`, `submission:finished` and `leaderboard:updated`.

## For Person 2

- Review CR-021 / migration 005 (triggers + one partial index, no column changes).
- Each API instance now holds one extra long-lived connection (for `LISTEN dsa_events`), in addition to the worker's.

## Known issues / next

1. The gateway's LISTEN connection doesn't reconnect if it drops. Sockets stay up but stop getting events until restart, so polling covers it. Add a reconnect before long uptimes.
2. An open socket isn't kicked out when its access token expires (it was checked at connect). Fine for 15-minute tokens. Day 8 can add a periodic re-check.
3. The leaderboard ranks all users with a solve on every request (`shortcut:` comment in `leaderboard/store.ts`). Fine for thousands of users, and Person 3's cache helps. Precompute it if it grows.
4. Socket.IO accepts any origin, like REST CORS today. Day 8 adds the allow-list to both.
5. `leaderboard:updated` fires on every fully passing submission, re-solves included. Clients should debounce refetches.

## Design decisions (for the viva)

- **Triggers as the event source:** the status change and its event can't drift apart, and no code path (API, worker, retry, admin requeue) can forget to publish. Events go out only on commit, so a client never hears about a result before it can read it.
- **LISTEN/NOTIFY instead of Redis + adapter:** every instance receives every event and serves only its own sockets. That's the same fan-out the Redis adapter gives, with one service fewer. Limits: 8 KB payloads (we send ids only) and no replay, so REST stays the source of truth.
- **Small payloads, then refetch:** events say _what changed_, and REST says _what it is now_. A missed or reordered event can't leave a client showing wrong data for long.
- **Deterministic daily pick + insert-announces:** every worker computes the same problem, `ON CONFLICT DO NOTHING` lets one row win, and the insert trigger means `daily:new` fires exactly once with no locking or leader election.
- **Ranking by solved, then time to reach it:** the usual contest tie-break. It needs no per-problem timing data we don't have (Person 3 noted there's no "started at").
