# OpenAPI ↔ Schema Compatibility Audit

Cross-reference of every endpoint in `/docs/openapi.yaml` against the database schema to
verify all queries are supportable.

---

## Audit Results

### ✅ Fully Compatible

| Endpoint                                 | Method | Schema support                                                                                                                                                      |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/auth/register`                  | POST   | `INSERT INTO users` — username/email UNIQUE constraints handle 409                                                                                                  |
| `/api/v1/auth/login`                     | POST   | `SELECT ... FROM users WHERE email = $1` — compare bcrypt hash                                                                                                      |
| `/api/v1/auth/refresh`                   | POST   | `SELECT ... FROM sessions WHERE token_hash = sha256($1) AND expires_at > now()`                                                                                     |
| `/api/v1/auth/logout`                    | POST   | `DELETE FROM sessions WHERE token_hash = sha256($1)`                                                                                                                |
| `/api/v1/auth/me`                        | GET    | `SELECT ... FROM users WHERE id = $1` (from JWT payload)                                                                                                            |
| `/api/v1/topics`                         | GET    | No table needed — return hardcoded list from app code (matches `Topic` type in core)                                                                                |
| `/api/v1/problems`                       | GET    | `SELECT id, slug, title, topic, difficulty FROM problems WHERE is_published = true` with optional `topic`/`difficulty` filters and keyset cursor `(created_at, id)` |
| `/api/v1/problems/random`                | GET    | `SELECT * FROM problems WHERE topic = $1 AND difficulty = $2 AND is_published = true ORDER BY random() LIMIT 1`                                                     |
| `/api/v1/problems/{id}`                  | GET    | `SELECT ... FROM problems WHERE slug = $1 OR id = $1::uuid` with JOINs to `test_cases`, `hints`, `solutions`                                                        |
| `/api/v1/problems/{id}/hints`            | GET    | `SELECT level, content FROM hints WHERE problem_id = $1 AND level <= $2 ORDER BY level`                                                                             |
| `/api/v1/problems/{id}/solution`         | GET    | `SELECT code FROM solutions WHERE problem_id = $1` + unlock check via `submissions`                                                                                 |
| `/api/v1/submissions`                    | POST   | `INSERT INTO submissions (user_id, problem_id, code, status) VALUES ($1, $2, $3, 'queued')` → returns `{submissionId, status}`                                      |
| `/api/v1/submissions`                    | GET    | `SELECT ... FROM submissions WHERE user_id = $1` with optional `problem_id` filter and keyset cursor `(created_at DESC, id DESC)`                                   |
| `/api/v1/submissions/{id}`               | GET    | `SELECT ... FROM submissions WHERE id = $1` (PK lookup)                                                                                                             |
| `/api/v1/stats/me`                       | GET    | Aggregate from `user_problem_stats` + streak computation from `first_solved_at` dates                                                                               |
| `/api/v1/stats/me/topics`                | GET    | `SELECT p.topic, COUNT(*), COUNT(*) FILTER (WHERE ups.solved) FROM user_problem_stats ups JOIN problems p ON ... WHERE ups.user_id = $1 GROUP BY p.topic`           |
| `/api/v1/daily-challenge`                | GET    | `SELECT ... FROM daily_challenges dc JOIN problems p ON dc.problem_id = p.id WHERE dc.challenge_date = CURRENT_DATE`                                                |
| `/api/v1/admin/problems`                 | POST   | `INSERT INTO problems` + `INSERT INTO test_cases` + `INSERT INTO hints` + `INSERT INTO solutions` (in a transaction)                                                |
| `/api/v1/admin/problems`                 | PUT    | `UPDATE problems SET ... WHERE id = $1` + cascade updates to child tables                                                                                           |
| `/api/v1/admin/problems`                 | DELETE | `DELETE FROM problems WHERE id = $1` (CASCADE deletes test_cases, hints, solutions, etc.)                                                                           |
| `/api/v1/admin/problems/{id}/test-cases` | POST   | `INSERT INTO test_cases (problem_id, sort_order, input, expected) VALUES ...`                                                                                       |
| `/api/v1/sync/push`                      | POST   | `INSERT INTO submissions` (bulk) + upsert `user_problem_stats` + log to `sync_operations`                                                                           |
| `/api/v1/sync/pull`                      | GET    | `SELECT ... FROM submissions WHERE user_id = $1 AND created_at > $since` + `SELECT ... FROM problems WHERE updated_at > $since`                                     |

---

### ⚠️ Flags — Supported with Notes

#### Flag 1: `ProblemSummary.id` returns slug, not UUID

**Endpoint:** `GET /api/v1/problems`  
**OpenAPI field:** `ProblemSummary.id` (type: string)  
**Issue:** Our PK is a UUID, but the API spec shows `id` as a plain string (e.g., `"two-sum"`).  
**Resolution:** The API route handler maps `slug → id` in the response. The `slug` column
serves as the public-facing identifier. Person 1's route handler does:

```typescript
return { id: problem.slug, title: problem.title, ... };
```

**Impact:** None — schema fully supports this. Just a mapping concern in the API layer.

---

#### Flag 2: `LeaderboardEntry.totalScore` — computed, not stored

**Endpoint:** `GET /api/v1/leaderboard`  
**OpenAPI field:** `LeaderboardEntry.totalScore` (type: integer)  
**Issue:** No `total_score` column in any table. Must be computed.  
**Resolution:** Compute at query time:

```sql
SELECT
    u.id AS user_id,
    u.username,
    COUNT(*) FILTER (WHERE ups.solved) AS solved,
    SUM(
        CASE p.difficulty
            WHEN 'Easy' THEN 1
            WHEN 'Medium' THEN 2
            WHEN 'Hard' THEN 3
        END
    ) FILTER (WHERE ups.solved) AS total_score
FROM users u
JOIN user_problem_stats ups ON ups.user_id = u.id
JOIN problems p ON p.id = ups.problem_id
GROUP BY u.id, u.username
ORDER BY solved DESC, total_score DESC
```

**Impact:** Moderate query cost. If performance becomes an issue (>10k active users), add a
materialized view or denormalized `total_score` column to `user_problem_stats`. For MVP, the
computed approach is fine.

---

#### Flag 3: `StreakStat` — computed from date series

**Endpoint:** `GET /api/v1/stats/me`  
**OpenAPI fields:** `StreakStat.currentStreak`, `StreakStat.longestStreak`, `StreakStat.lastSolvedAt`  
**Issue:** No streak columns stored. Must be computed from `user_problem_stats.first_solved_at`.  
**Resolution:** Compute in application code or with a window-function query:

```sql
-- Get all distinct solve dates for a user
SELECT DISTINCT first_solved_at::date AS solve_date
FROM user_problem_stats
WHERE user_id = $1 AND solved = true
ORDER BY solve_date DESC;
```

Then compute streaks in application code (iterate dates, count consecutive days).  
**Impact:** Low cost — typically <100 rows per user. Application-level computation is simpler
and more testable than a complex SQL window function.

---

#### Flag 4: `GET /api/v1/topics` — no topics table

**Endpoint:** `GET /api/v1/topics`  
**Issue:** No `topics` table exists. The endpoint returns `{ topics: ["Arrays", "Strings", ...] }`.  
**Resolution:** Return the topic list from application code (hardcoded from the `Topic` type
in `@dsa-portal/core`). Alternatively, `SELECT DISTINCT topic FROM problems WHERE is_published = true`.  
**Impact:** None. A dedicated table would be over-engineering for 8 static values.

---

## Summary

| Category                 | Count                                 |
| ------------------------ | ------------------------------------- |
| ✅ Fully compatible      | 24 endpoints                          |
| ⚠️ Compatible with notes | 4 flags (all resolvable in API layer) |
| ❌ Not supported         | 0                                     |

**Conclusion:** The schema fully supports every endpoint in the OpenAPI specification. All
4 flags are API-layer mapping concerns, not schema deficiencies.
