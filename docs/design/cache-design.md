# Cache design (Person 3, Day 7)

(The prompt pack asks for `/docs/cache-design.md`; it lives in `/docs/design`, Person 3's folder.)
Code: `server/src/cache/cache.ts` (helper), `server/src/cache/cached-problem.repository.ts` (problems),
`server/src/modules/leaderboard`, `server/src/modules/daily` (their routes use the helper).

## What is cached

| Data                                   | Key                                                      | TTL   | Invalidated when                                          |
| -------------------------------------- | -------------------------------------------------------- | ----- | --------------------------------------------------------- |
| Problem detail                         | `dsa:v1:problem:<slug>`                                  | 600 s | admin create/update/delete of that problem                |
| Problem lists (per topic × difficulty) | `dsa:v1:problems:g<gen>:list:<topic\|*>:<difficulty\|*>` | 300 s | any admin change (generation bump)                        |
| Leaderboard pages                      | `dsa:v1:leaderboard:g<gen>:<offset>:<limit>`             | 30 s  | every judged submission (the worker bumps the generation) |
| Daily challenge                        | `dsa:v1:daily:g<gen>:<YYYY-MM-DD>`                       | 300 s | any admin change to problems                              |

**Never cached:** anything user-private: stats, submissions, auth/sessions, solutions-unlocked checks. They are
per-user (low hit rate) and a stale or wrongly-keyed entry would show one user another user's data.

Naming: `dsa:v1:` prefix (the `v1` lets a deploy with a new value format start clean), then the namespace.
Every TTL gets up to +10 % random jitter so keys written in the same second don't all expire together.

## Patterns

- **Cache-aside:** read Redis → on a miss load from PostgreSQL → write back with TTL. PostgreSQL stays the
  source of truth; Redis only ever holds copies.
- **Generations instead of key scans:** list and page keys include a generation number. Invalidating "all problem
  lists" is one `INCR dsa:v1:gen:problems`; the old keys are never read again and expire on their own. No `KEYS`/`SCAN`.
- **Stampede protection:** (1) in one process, concurrent misses for a key share one load (single flight);
  (2) across processes, only the caller that wins `SET <key>:lock NX PX 5000` loads; the others poll the key for up to
  2 s and, if the leader is slow or died, load once themselves. So a hot key expiring under load costs one DB query per
  key, not one per request.
- **Negative caching:** "problem not found" is cached too (as `null`), so a client hammering a bad id doesn't reach the DB.

## Consistency trade-offs (stale reads)

- After an admin edit, this server instance sees the change at once (the write deletes/bumps keys before returning).
  Other instances also read through Redis, so they see it on their next read; nothing is cached in process memory.
- The leaderboard can lag a judged submission by the time between "worker saves the result" and "worker bumps the
  generation" (milliseconds); worst case (a missed bump) it self-heals within the 30 s TTL.
- A problem looked up by its UUID instead of its slug is only refreshed by TTL (clients use slugs). Documented shortcut.

## What happens if Redis is down

The cache is an optimisation, never a dependency. The Redis client fails fast (no offline queue, 500 ms command
timeout); every failed call counts in `dsa_cache_errors_total` and the request is served straight from PostgreSQL.
With `REDIS_URL` unset the cache is off entirely. Tested: `cache.test.ts` ("Redis down", "a dead Redis…").

## CAP in plain words

When the network between our servers and Redis breaks (a partition), we have to choose: refuse requests until Redis is
back (consistent but unavailable) or keep answering (available but possibly stale). We choose **availability**: requests
fall back to PostgreSQL, which is always correct, and when Redis returns it may hold entries up to one TTL old. For
problem text and a leaderboard that is fine; that is exactly why user-private and money-like data are never cached.

## Metrics (for Person 2's Prometheus)

`GET /metrics` on the API server (outside `/api/v1`):
`dsa_cache_requests_total{result="hit"|"miss"}` and `dsa_cache_errors_total`. Hit ratio = hit / (hit + miss).

## Usage for Person 1

```ts
const key = await cache.genKey('my-namespace', 'part1', 'part2'); // or cache.key('thing', id) for single items
const value = await cache.getOrLoad(key, 60, () => loadFromDb()); // TTL seconds; jitter + stampede lock built in
await cache.bumpGeneration('my-namespace'); // invalidate every key of a namespace
await cache.invalidate(cache.key('thing', id)); // invalidate one key
```

`buildApp({ cache })` passes it to routes as `deps.cache`; the server builds it with `cacheFromEnv()` (`REDIS_URL`).
