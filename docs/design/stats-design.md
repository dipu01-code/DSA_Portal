# Stats model design (Person 3, Day 4)

(The prompt pack asks for `/docs/db/stats-design.md`; `/docs/db` is Person 2's folder, so it lives here.)

## What we need

Per user: problems attempted and solved, per-topic and per-difficulty accuracy (solved ÷ attempted), current and longest streak, and a calendar of solve days. Average time per problem is **not** possible yet: nothing records when a user opens a problem (would need a `started_at` per attempt; left for later).

## Three designs

|             | Compute on read                                      | Maintained counters (chosen)                                                                                     | Materialized view                                          |
| ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| How         | `GROUP BY` over all `submissions` on every request   | `user_problem_stats` row per (user, problem), upserted in the **same transaction** that stores the judged result | `REFRESH MATERIALIZED VIEW` over submissions on a schedule |
| Read cost   | grows with the submission history (scan per request) | one indexed lookup + small aggregates (≤ 40 rows per user)                                                       | cheap                                                      |
| Write cost  | none                                                 | one upsert per judged submission                                                                                 | the refresh rescans everything                             |
| Freshness   | always exact                                         | always exact (same transaction)                                                                                  | stale until the next refresh                               |
| Concurrency | n/a                                                  | `ON CONFLICT DO UPDATE` locks the one row; increments can't be lost                                              | refresh blocks or needs `CONCURRENTLY` + unique index      |
| Risk        | slow under load (Day 9 load test)                    | counters can drift if someone writes submissions without the function                                            | stale dashboards, heavy refreshes                          |

**Choice: maintained counters.** Reads stay constant-time as history grows, and doing the write inside the submission transaction means stats can never disagree with submissions. Person 2's schema already has `user_problem_stats`; no migration needed.

## Write path

`updateStatsOnSubmission(tx, submission)` (`server/src/modules/stats/stats.service.ts`), for judged submissions only:
`attempts + 1`, `solved = solved OR this one passed`, `first_solved_at` set once, `last_attempted_at = now()`.
Today `PostgresSubmissionRepository.save()` runs the same SQL inline; CR-017 asks it to call this function. Tested with 10 concurrent transactions on one (user, problem): 10 attempts, solved, one row.

## Read path (`PostgresStatsStore`)

- summary: `getUserStats` (Person 2) → attempted, solved, totalProblems
- `getTopicStats`, `getDifficultyStats`: `GROUP BY` over the user's ≤ 40 counter rows joined to `problems`
- `getFirstSolves`: `first_solved_at` of every solved problem → streak + calendar

## Streak rules

- A day counts when the user solves a problem **for the first time** that day (re-solving an old problem doesn't count; it stops farming streaks with one easy problem).
- Days are **UTC** calendar days, the same for every client, so the streak doesn't change when a laptop changes timezone. Trade-off: a user in UTC+5:30 sees the day roll over at 05:30 local time. A per-user timezone setting would fix it later.
- The current streak survives until the end of the next UTC day (you haven't lost it just because you haven't solved anything yet today).
- `longestStreak` is the longest run ever; `lastSolvedAt` is the latest first-solve instant.

## API

`GET /stats/me` → `{ attempted, solved, totalProblems, streak: StreakStat, topics: TopicStat[], difficulties[] }`,
`GET /stats/me/topics` → `{ topics }`, `GET /stats/me/streak` → `StreakStat & { days: string[] }` (CR-016).
Stats are user-private, so they are never cached in Redis (Day 7 rule).
