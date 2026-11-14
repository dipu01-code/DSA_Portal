# Day 4 — Person 3: stats model, stats API, web problem page and dashboard

## What was built

- Design comparison (compute on read / maintained counters / materialized view) and streak rules: `docs/design/stats-design.md`. Chosen: counters in `user_problem_stats`, updated in the submission transaction.
- `updateStatsOnSubmission(tx, submission)` exported from `server/src/modules/stats/stats.service.ts` for the worker path (CR-017: Person 2's `save()` should call it; same SQL as today).
- `PostgresStatsStore` (Person 2's repository + first-solve dates + difficulty breakdown); `computeStreak` (UTC days).
- API: `GET /stats/me` (now with `streak` and `difficulties`), `/stats/me/topics`, `/stats/me/streak` (CR-016).
- Tests incl. 10 concurrent submissions against real Postgres (`person3-postgres.test.ts`).
- Web problem page: description, examples, Monaco (bundled, JS), **Run** (visible tests in a Web Worker with a 3 s kill switch; desktop uses the local sandbox) and **Submit** (server judge, polling), progressive hints, solution behind a confirm dialog, per-test results panel.
- Stats dashboard (Recharts): tiles (solved, attempted, accuracy, streak), attempted/solved by topic and by difficulty with legend + tooltip (accuracy), table view, 12-week streak calendar; loading skeleton, error + retry, empty state.

## How to run

```bash
npx jest server/__tests__/stats.test.ts      # streak rules + stats API
npm test -w web                              # login flow, stats states, results panel
```

## Stats response shapes (for the mobile app)

```jsonc
GET /api/v1/stats/me
{ "attempted": 3, "solved": 2, "totalProblems": 40,
  "streak": { "currentStreak": 2, "longestStreak": 5, "lastSolvedAt": "2026-11-12T08:00:00.000Z" },
  "topics": [{ "topic": "Arrays", "attempted": 2, "solved": 2 }],
  "difficulties": [{ "difficulty": "Easy", "attempted": 2, "solved": 2 }] }
GET /api/v1/stats/me/topics   → { "topics": [ …TopicStat ] }
GET /api/v1/stats/me/streak   → { "currentStreak": 2, "longestStreak": 5, "lastSolvedAt": "…", "days": ["2026-11-11", "2026-11-12"] }
```

In code: `useStats()` → `{ summary, streak }` typed as `StatsMe` / `StreakDetail`.

## Known issues

1. `/stats/me/streak` and `difficulties` are not in `openapi.yaml` yet (CR-016). 2. Average time per problem isn't tracked (no `started_at`). 3. Web "Run" executes the user's own code in their browser (fine: it's their code and tab); grading is always server-side. 4. Monaco makes the editor chunk ~3 MB (lazy-loaded on the problem page only; Lighthouse on Day 8). 5. Streak days are UTC.

## Design decisions (viva)

- **Counters in the same transaction**: exact and cheap to read; no drift between submissions and stats.
- **"First solve per day" streaks**: re-solving one easy problem can't keep a streak alive.
- **UTC days**: the same answer on every device; trade-off documented.
- **Run vs Submit**: instant feedback locally, authoritative judging on the server sandbox.
- **Accessible charts**: colour pair validated for colour-blind readers, legend + tooltip, table view, text tiles carry the key numbers.
