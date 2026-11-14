# Handover — Day 0, Person 2

## What was built

Phase 0 — Database schema design, ER diagram, migration tooling decision, and initial DDL for the DSA Practice Platform.

All work committed to branch `person-2/day-0`.

---

## Schema Documentation for the Team

### For Person 1 (Backend, Core Engine, Submissions)

#### Problems & Related Tables

| Table              | PK                      | Key columns                                                                                    | Notes                                                                                                                                                          |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `problems`         | `id` (UUID)             | `slug` (UNIQUE), `title`, `topic`, `difficulty`, `description`, `starter_code`, `is_published` | Use `slug` in URL paths (`/problems/:id` matches either UUID or slug). `topic` is validated via CHECK constraint matching `@dsa-portal/core`'s `Topic` type.   |
| `test_cases`       | `id` (UUID)             | `problem_id` (FK), `sort_order`, `input` (JSONB), `expected` (JSONB), `is_sample`              | `input` and `expected` are JSONB — deserialize with `JSON.parse` if needed, or pass directly to executor.                                                      |
| `hints`            | `id` (UUID)             | `problem_id` (FK), `level` (int >= 1), `content`                                               | Progressive hints ordered by `level`. UNIQUE on `(problem_id, level)`.                                                                                         |
| `solutions`        | `id` (UUID)             | `problem_id` (FK, UNIQUE), `code`, `explanation`                                               | 1:1 with problems. Solution unlock check: query `submissions` where `user_id = $1 AND problem_id = $2 AND status = 'judged' AND passed = total AND total > 0`. |
| `daily_challenges` | `challenge_date` (DATE) | `problem_id` (FK)                                                                              | PK is date. For today: `WHERE challenge_date = CURRENT_DATE`.                                                                                                  |

#### Submissions & Execution

| Table         | PK          | Key columns                                                                                                          | Notes                                                                                                                                                                                              |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submissions` | `id` (UUID) | `user_id` (FK), `problem_id` (FK), `code`, `status`, `passed`, `total`, `results` (JSONB), `created_at`, `judged_at` | `status` enum: `queued`, `running`, `judged`, `failed`. `results` stores the array `[{testCaseIndex, passed, actual, expected, error}]`. `passed` and `total` are denormalized for fast filtering. |

**Important for worker (`/workers`):**
When a submission is judged, the worker should run in a single transaction:

1. `UPDATE submissions SET status = 'judged', passed = $p, total = $t, results = $r, judged_at = now() WHERE id = $id`
2. Upsert `user_problem_stats`:
   ```sql
   INSERT INTO user_problem_stats (user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at)
   VALUES ($user_id, $problem_id, 1, ($passed = $total), CASE WHEN $passed = $total THEN now() END, now())
   ON CONFLICT (user_id, problem_id) DO UPDATE SET
       attempts = user_problem_stats.attempts + 1,
       solved = user_problem_stats.solved OR EXCLUDED.solved,
       first_solved_at = COALESCE(user_problem_stats.first_solved_at, EXCLUDED.first_solved_at),
       last_attempted_at = now();
   ```

---

### For Person 3 (Clients, Auth, Stats, Admin)

#### Auth & Sessions

| Table      | PK          | Key columns                                                                                             | Notes                                                                                                                        |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `users`    | `id` (UUID) | `username` (UNIQUE, 3-30 chars), `email` (UNIQUE), `password_hash` (bcrypt), `role` (`user` \| `admin`) | Check constraints enforce username length and email format.                                                                  |
| `sessions` | `id` (UUID) | `user_id` (FK), `token_hash` (UNIQUE), `expires_at`, `ip_address`, `user_agent`                         | **Never store raw refresh tokens.** Store `sha256(refreshToken)`. On refresh: hash incoming token and query by `token_hash`. |

#### Stats & Leaderboard

| Table                | PK          | Key columns                                                                                            | Notes                                               |
| -------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `user_problem_stats` | `id` (UUID) | `user_id` (FK), `problem_id` (FK), `attempts`, `solved` (bool), `first_solved_at`, `last_attempted_at` | Pre-aggregated per-user-per-problem stats. Use for: |

- **Per-topic stats (`GET /stats/me/topics`):**
  ```sql
  SELECT p.topic, COUNT(*) AS attempted, COUNT(*) FILTER (WHERE ups.solved) AS solved
  FROM user_problem_stats ups
  JOIN problems p ON p.id = ups.problem_id
  WHERE ups.user_id = $user_id
  GROUP BY p.topic;
  ```
- **Overall stats (`GET /stats/me`):**
  - `attempted`: `COUNT(*)` from `user_problem_stats WHERE user_id = $1`
  - `solved`: `COUNT(*) FILTER (WHERE solved)` from `user_problem_stats WHERE user_id = $1`
  - `totalProblems`: `COUNT(*) FROM problems WHERE is_published = true`
  - `streak`: Compute in application code by ordering distinct `first_solved_at::date` descending.
- **Leaderboard (`GET /leaderboard`):**
  ```sql
  SELECT
      u.id AS user_id,
      u.username,
      COUNT(*) FILTER (WHERE ups.solved) AS solved,
      COALESCE(SUM(
          CASE p.difficulty
              WHEN 'Easy' THEN 1
              WHEN 'Medium' THEN 2
              WHEN 'Hard' THEN 3
          END
      ) FILTER (WHERE ups.solved), 0) AS total_score,
      RANK() OVER (ORDER BY COUNT(*) FILTER (WHERE ups.solved) DESC, ...) AS rank
  FROM users u
  JOIN user_problem_stats ups ON ups.user_id = u.id
  JOIN problems p ON p.id = ups.problem_id
  GROUP BY u.id, u.username
  ORDER BY solved DESC, total_score DESC;
  ```

#### Admin

| Table       | PK            | Key columns                                                                                                           | Notes                                                                                                    |
| ----------- | ------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `audit_log` | `id` (BIGINT) | `actor_id` (FK → users), `action`, `entity_type`, `entity_id`, `old_value` (JSONB), `new_value` (JSONB), `ip_address` | Log admin actions here. Append-only, indexed by `(entity_type, entity_id)` and `(actor_id, created_at)`. |

---

## Deliverables Summary

| File                                               | Purpose                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/docs/db/er-diagram.md`                           | Mermaid ER diagram, 3NF justification, denormalization rationale               |
| `/docs/db/decisions.md`                            | Decision notes: node-pg-migrate vs Prisma, ID strategy, topic storage          |
| `/docs/db/indexes.md`                              | Index catalog: 12 explicit indexes, queries served, justifications             |
| `/docs/db/schema-audit.md`                         | Audit of 24 OpenAPI endpoints against the schema (4 flags, all handled)        |
| `/server/src/db/migrations/001_initial_schema.sql` | Executable PostgreSQL DDL with all 11 tables, types, constraints, and triggers |

---

## Design Decisions & Trade-offs (for Viva)

1. **node-pg-migrate over Prisma:**
   Prisma generates a heavy runtime binary (~15 MB) and abstracts DDL behind a DSL. We chose raw SQL migrations via node-pg-migrate because: (a) the team already committed to repository interfaces in `@dsa-portal/core/types.ts` that will be implemented with parameterized SQL; (b) we need PostgreSQL-specific features (partial indexes, JSONB constraints, `gen_random_uuid()`) that Prisma doesn't fully support; (c) demonstrates deeper SQL knowledge in the viva.

2. **UUID PK + Slug for problems:**
   Internal FKs use UUIDs (stable, indexable, collision-free). Problems also have a unique `slug` (e.g. `"two-sum"`) for human-readable URLs and compatibility with Person 1's existing core engine.

3. **Hashed refresh tokens:**
   Storing plaintext tokens in the DB is a major vulnerability. We store `sha256(token)`, so even a full DB dump does not compromise active sessions.

4. **Deliberate denormalization in `user_problem_stats`:**
   Stats could be computed from `submissions` via `GROUP BY`, but leaderboard and per-topic stats would become O(all_submissions). Pre-aggregating per-user-per-problem makes queries O(problems_attempted) at the cost of a single upsert on submission judgment.

5. **JSONB for test cases and submission results:**
   Test case inputs and submission results are always read and written as complete documents (the executor consumes the whole input; the judge writes the whole result set). Storing them as JSONB avoids creating 2 extra tables with zero query benefit.

---

## How to Verify

- Schema is documented in `/docs/db/`.
- Review DDL in `/server/src/db/migrations/001_initial_schema.sql`.
- Branch: `person-2/day-0`.
