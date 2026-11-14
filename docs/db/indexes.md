# Index Catalog

Every index in the schema, the query it serves, and why it is needed.

> **Convention:** Indexes created by `PRIMARY KEY` and `UNIQUE` constraints are not listed here
> (PostgreSQL creates them automatically). Only explicitly created indexes are documented.

---

## users

```sql
-- Implicit: PRIMARY KEY (id) → unique B-tree on id
-- Implicit: UNIQUE (username) → unique B-tree on username
-- Implicit: UNIQUE (email) → unique B-tree on email
```

No additional indexes needed. The UNIQUE constraints on `email` and `username` already cover
login lookups (`WHERE email = $1`) and registration duplicate checks.

---

## sessions

```sql
-- Implicit: PRIMARY KEY (id)
-- Implicit: UNIQUE (token_hash) → covers refresh token validation

CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
```

| Index                     | Query it serves                                                          | Why needed                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_sessions_expires_at` | `DELETE FROM sessions WHERE expires_at < now()` (scheduled cleanup cron) | Without this index, the cleanup job would seq-scan the entire sessions table. With ~1000s of sessions, an index on `expires_at` makes the periodic purge O(expired_count). |

```sql
CREATE INDEX idx_sessions_user_id ON sessions (user_id);
```

| Index                  | Query it serves                                                                                                         | Why needed                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `idx_sessions_user_id` | `DELETE FROM sessions WHERE user_id = $1` (logout all sessions), `SELECT ... WHERE user_id = $1` (list active sessions) | FK index — PostgreSQL does NOT auto-index FK columns. Without this, any `DELETE FROM users` or logout-all would seq-scan sessions. |

---

## problems

```sql
-- Implicit: PRIMARY KEY (id)
-- Implicit: UNIQUE (slug)

CREATE INDEX idx_problems_topic_difficulty
    ON problems (topic, difficulty)
    WHERE is_published = true;
```

| Index                           | Query it serves                                                                                                                                  | Why needed                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_problems_topic_difficulty` | **Q1:** `GET /problems/random` → `SELECT * FROM problems WHERE topic = $1 AND difficulty = $2 AND is_published = true ORDER BY random() LIMIT 1` | Composite index on the two filter columns. Partial index (`WHERE is_published`) excludes draft problems, keeping the index smaller. Without this, every random-problem request would seq-scan all problems. |

```sql
CREATE INDEX idx_problems_cursor
    ON problems (created_at, id)
    WHERE is_published = true;
```

| Index                 | Query it serves                                                                                                                                                                 | Why needed                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_problems_cursor` | `GET /problems?cursor=...&limit=20` → `SELECT ... FROM problems WHERE is_published = true AND (created_at, id) > ($cursor_ts, $cursor_id) ORDER BY created_at, id LIMIT $limit` | Keyset cursor pagination requires an ordered index on the cursor columns. Without this, pagination would require sorting the entire problems table on every request. |

---

## test_cases

```sql
-- Implicit: PRIMARY KEY (id)
-- Implicit: UNIQUE (problem_id, sort_order)

CREATE INDEX idx_test_cases_problem_id ON test_cases (problem_id, sort_order);
```

| Index                       | Query it serves                                                                                                           | Why needed                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_test_cases_problem_id` | `SELECT * FROM test_cases WHERE problem_id = $1 ORDER BY sort_order` (load test cases for executor / problem detail view) | The UNIQUE constraint on `(problem_id, sort_order)` already creates this index. Listed here for completeness — **no separate CREATE INDEX needed.** |

---

## hints

```sql
-- Implicit: PRIMARY KEY (id)
-- Implicit: UNIQUE (problem_id, level)

CREATE INDEX idx_hints_problem_level ON hints (problem_id, level);
```

| Index                     | Query it serves                                                                                               | Why needed                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_hints_problem_level` | `GET /problems/:id/hints?upto=N` → `SELECT * FROM hints WHERE problem_id = $1 AND level <= $2 ORDER BY level` | The UNIQUE constraint on `(problem_id, level)` already creates this index. Listed here for completeness — **no separate CREATE INDEX needed.** |

---

## submissions

```sql
-- Implicit: PRIMARY KEY (id)

CREATE INDEX idx_submissions_user_cursor
    ON submissions (user_id, created_at DESC, id DESC);
```

| Index                         | Query it serves                                                                                                                                                                         | Why needed                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_submissions_user_cursor` | **Q2:** `GET /submissions?cursor=...` → `SELECT ... FROM submissions WHERE user_id = $1 AND (created_at, id) < ($cursor_ts, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT $limit` | Keyset cursor pagination for a user's submission history. Descending order shows newest first. Three-column index covers the equality filter (user_id), sort order (created_at DESC), and tie-breaker (id DESC). |

```sql
CREATE INDEX idx_submissions_user_problem
    ON submissions (user_id, problem_id, created_at DESC);
```

| Index                          | Query it serves                                                                                                                | Why needed                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idx_submissions_user_problem` | `GET /submissions?problemId=X` → `SELECT ... FROM submissions WHERE user_id = $1 AND problem_id = $2 ORDER BY created_at DESC` | Filters submission history by problem. Also used for the solution-unlock check: `SELECT 1 FROM submissions WHERE user_id = $1 AND problem_id = $2 AND status = 'judged' AND passed = total AND total > 0 LIMIT 1`. |

```sql
CREATE INDEX idx_submissions_solved
    ON submissions (user_id, problem_id)
    WHERE status = 'judged' AND passed = total AND total > 0;
```

| Index                    | Query it serves                                                                                                                                                                                | Why needed                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_submissions_solved` | `GET /problems/:id/solution` → solution-unlock check: `SELECT EXISTS(SELECT 1 FROM submissions WHERE user_id = $1 AND problem_id = $2 AND status = 'judged' AND passed = total AND total > 0)` | Partial index that only includes successful submissions. Very small (only solved submissions), making the unlock check extremely fast. |

```sql
CREATE INDEX idx_submissions_sync
    ON submissions (user_id, created_at);
```

| Index                  | Query it serves                                                                                                                    | Why needed                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_submissions_sync` | **Q6:** `GET /sync/pull?since=<ts>` → `SELECT ... FROM submissions WHERE user_id = $1 AND created_at > $since ORDER BY created_at` | Sync pull fetches all submissions newer than the client's last sync timestamp. Without this index, sync would seq-scan all of a user's submissions. |

---

## user_problem_stats

```sql
-- Implicit: PRIMARY KEY (id)
-- Implicit: UNIQUE (user_id, problem_id)

CREATE INDEX idx_ups_user_id ON user_problem_stats (user_id);
```

| Index             | Query it serves                                                                                                                                                                                                                     | Why needed                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idx_ups_user_id` | **Q3:** `GET /stats/me/topics` → `SELECT p.topic, COUNT(*) AS attempted, COUNT(*) FILTER (WHERE ups.solved) AS solved FROM user_problem_stats ups JOIN problems p ON ups.problem_id = p.id WHERE ups.user_id = $1 GROUP BY p.topic` | Fetches all of a user's problem stats for aggregation by topic. Also used for **Q4** (leaderboard): `SELECT user_id, COUNT(*) FILTER (WHERE solved) AS solved_count FROM user_problem_stats GROUP BY user_id ORDER BY solved_count DESC`. |

---

## daily_challenges

```sql
-- Implicit: PRIMARY KEY (challenge_date) → unique B-tree on challenge_date
```

No additional indexes needed. **Q5** (`GET /daily-challenge`) queries by `challenge_date = CURRENT_DATE`, which is a PK lookup — the fastest possible query.

---

## audit_log

```sql
-- Implicit: PRIMARY KEY (id) → BIGINT IDENTITY, sequential

CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
```

| Index              | Query it serves                                                                                                                                         | Why needed                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `idx_audit_entity` | Admin tooling: "show me all changes to problem X" → `SELECT * FROM audit_log WHERE entity_type = 'problem' AND entity_id = $1 ORDER BY created_at DESC` | Without this, finding the history of a specific entity would require scanning the entire audit log. |

```sql
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at DESC);
```

| Index             | Query it serves                                                                                                         | Why needed                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `idx_audit_actor` | Admin tooling: "show me all actions by user Y" → `SELECT * FROM audit_log WHERE actor_id = $1 ORDER BY created_at DESC` | Without this, finding a user's audit trail would require scanning the entire audit log. |

---

## sync_operations

```sql
-- Implicit: PRIMARY KEY (id)

CREATE INDEX idx_sync_user ON sync_operations (user_id, synced_at DESC);
```

| Index           | Query it serves                                                                                                          | Why needed                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `idx_sync_user` | Debug/admin: "show sync history for user X" → `SELECT * FROM sync_operations WHERE user_id = $1 ORDER BY synced_at DESC` | Without this, finding a user's sync history would require scanning all sync records. |

---

## Summary

| Table              | Implicit indexes (PK/UNIQUE)  | Explicit indexes | Total  |
| ------------------ | ----------------------------- | ---------------- | ------ |
| users              | 3 (id, username, email)       | 0                | 3      |
| sessions           | 2 (id, token_hash)            | 2                | 4      |
| problems           | 2 (id, slug)                  | 2                | 4      |
| test_cases         | 2 (id, problem_id+sort_order) | 0                | 2      |
| hints              | 2 (id, problem_id+level)      | 0                | 2      |
| solutions          | 2 (id, problem_id)            | 0                | 2      |
| submissions        | 1 (id)                        | 4                | 5      |
| user_problem_stats | 2 (id, user_id+problem_id)    | 1                | 3      |
| daily_challenges   | 1 (challenge_date)            | 0                | 1      |
| audit_log          | 1 (id)                        | 2                | 3      |
| sync_operations    | 1 (id)                        | 1                | 2      |
| **Total**          | **19**                        | **12**           | **31** |
