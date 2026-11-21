# Sample Database Records (Section 2.D & 3)

This document provides representative sample records demonstrating the implemented database structure across all core tables, populated via `scripts/seed.ts` and `scripts/seed-load.ts`.

---

## 1. Table: `users`

```sql
SELECT id, username, email, role, created_at FROM users LIMIT 3;
```

| `id` (UUID) | `username` | `email` | `role` | `created_at` |
| :--- | :--- | :--- | :--- | :--- |
| `00000000-0000-0000-0000-000000000001` | `admin` | `admin@dsa.portal` | `admin` | `2026-11-14 07:26:43+00` |
| `00000000-0000-0000-0000-000000000002` | `student` | `student@dsa.portal` | `user` | `2026-11-14 07:26:43+00` |
| `08b463f8-841d-4e73-b351-c8db182d7773` | `user_00001` | `user_00001@practice.portal` | `user` | `2026-11-12 02:13:59+00` |

---

## 2. Table: `problems`

```sql
SELECT id, slug, title, topic, difficulty, is_published FROM problems LIMIT 3;
```

| `id` (UUID) | `slug` | `title` | `topic` | `difficulty` | `is_published` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2ac795d6-3bcb-4e1a-981a-7f73f13f960b` | `two-sum` | `Two Sum` | `Arrays` | `Easy` | `true` |
| `7af553ae-fd6f-418c-a23a-6f767abf61e9` | `best-time-to-buy-and-sell-stock` | `Best Time to Buy and Sell Stock` | `Arrays` | `Easy` | `true` |
| `00ed26f7-263a-406c-af7d-dd721301c4a8` | `contains-duplicate` | `Contains Duplicate` | `Arrays` | `Easy` | `true` |

---

## 3. Table: `test_cases`

```sql
SELECT id, problem_id, sort_order, input, expected, is_sample FROM test_cases WHERE problem_id = '2ac795d6-3bcb-4e1a-981a-7f73f13f960b' LIMIT 2;
```

| `id` | `problem_id` | `sort_order` | `input` (JSONB) | `expected` (JSONB) | `is_sample` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `c4a17b89-911e-4252-875f-22df81c810a1` | `2ac795d6-...` | `1` | `{"nums": [2, 7, 11, 15], "target": 9}` | `[0, 1]` | `true` |
| `e98b31a2-12ef-45fa-8b10-67c9d1a812b3` | `2ac795d6-...` | `2` | `{"nums": [3, 2, 4], "target": 6}` | `[1, 2]` | `true` |

---

## 4. Table: `hints`

```sql
SELECT id, problem_id, level, content FROM hints WHERE problem_id = '2ac795d6-3bcb-4e1a-981a-7f73f13f960b' ORDER BY level ASC;
```

| `id` | `problem_id` | `level` | `content` |
| :--- | :--- | :--- | :--- |
| `a1120011-0000-0000-0000-000000000001` | `2ac795d6-...` | `1` | `A brute force approach checks all pairs in O(n^2) time. Can you do it faster using a hash map?` |
| `a1120011-0000-0000-0000-000000000002` | `2ac795d6-...` | `2` | `As you iterate through the array, check if target - nums[i] is already in the hash map.` |

---

## 5. Table: `solutions`

```sql
SELECT id, problem_id, code, explanation FROM solutions WHERE problem_id = '2ac795d6-3bcb-4e1a-981a-7f73f13f960b';
```

| Attribute | Value |
| :--- | :--- |
| **`id`** | `b2230022-0000-0000-0000-000000000001` |
| **`problem_id`** | `2ac795d6-3bcb-4e1a-981a-7f73f13f960b` |
| **`code`** | `function twoSum(nums, target) { const map = new Map(); for (let i = 0; i < nums.length; i++) { const comp = target - nums[i]; if (map.has(comp)) return [map.get(comp), i]; map.set(nums[i], i); } return []; }` |
| **`explanation`** | `Time Complexity: O(n) with single pass hash table. Space Complexity: O(n) to store up to n elements.` |

---

## 6. Table: `submissions`

```sql
SELECT id, user_id, problem_id, status, passed, total, created_at, judged_at FROM submissions LIMIT 3;
```

| `id` | `user_id` | `problem_id` | `status` | `passed` | `total` | `created_at` | `judged_at` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `f0000001-0000-0000-0000-000000000001` | `08b463f8-...` | `2ac795d6-...` | `judged` | `4` | `4` | `2026-11-13 14:10:00+00` | `2026-11-13 14:10:01+00` |
| `f0000002-0000-0000-0000-000000000002` | `08b463f8-...` | `7af553ae-...` | `judged` | `2` | `4` | `2026-11-13 14:15:20+00` | `2026-11-13 14:15:22+00` |
| `f0000003-0000-0000-0000-000000000003` | `00000000-...` | `00ed26f7-...` | `judged` | `3` | `3` | `2026-11-13 15:02:11+00` | `2026-11-13 15:02:12+00` |

---

## 7. Table: `user_problem_stats`

```sql
SELECT id, user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at FROM user_problem_stats LIMIT 3;
```

| `id` | `user_id` | `problem_id` | `attempts` | `solved` | `first_solved_at` | `last_attempted_at` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `81c9a101-1234-4567-89ab-cdef01234567` | `08b463f8-...` | `2ac795d6-...` | `1` | `true` | `2026-11-13 14:10:01+00` | `2026-11-13 14:10:01+00` |
| `81c9a102-1234-4567-89ab-cdef01234567` | `08b463f8-...` | `7af553ae-...` | `2` | `false` | `NULL` | `2026-11-13 14:15:22+00` |
| `81c9a103-1234-4567-89ab-cdef01234567` | `00000000-...` | `00ed26f7-...` | `1` | `true` | `2026-11-13 15:02:12+00` | `2026-11-13 15:02:12+00` |

---

## 8. Table: `daily_challenges`

```sql
SELECT challenge_date, problem_id, created_at FROM daily_challenges LIMIT 2;
```

| `challenge_date` | `problem_id` | `created_at` |
| :--- | :--- | :--- |
| `2026-11-14` | `2ac795d6-3bcb-4e1a-981a-7f73f13f960b` | `2026-11-14 00:00:00+00` |
| `2026-11-15` | `7af553ae-fd6f-418c-a23a-6f767abf61e9` | `2026-11-15 00:00:00+00` |

---

## 9. Table: `audit_log`

```sql
SELECT id, actor_id, action, entity_type, entity_id, new_value, created_at FROM audit_log LIMIT 2;
```

| `id` | `actor_id` | `action` | `entity_type` | `entity_id` | `new_value` (JSONB) | `created_at` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `1` | `00000000-...` | `PROBLEM_PUBLISH` | `Problem` | `2ac795d6-...` | `{"is_published": true, "slug": "two-sum"}` | `2026-11-14 07:30:00+00` |
| `2` | `00000000-...` | `ROLE_CHANGE` | `User` | `08b463f8-...` | `{"previous_role": "user", "new_role": "admin"}` | `2026-11-14 07:35:10+00` |

---

## 10. Table: `sync_op_log`

```sql
SELECT device_id, op_id, user_id, entity, op_type, hlc_timestamp, server_seq FROM sync_op_log LIMIT 2;
```

| `device_id` | `op_id` | `user_id` | `entity` | `op_type` | `hlc_timestamp` | `server_seq` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `macbook_m2_cli` | `e1110011-0000-0000-0000-000000000001` | `08b463f8-...` | `submission` | `INSERT` | `1731580200000.00001.macbook_m2_cli` | `1` |
| `iphone_expo_app` | `e1110011-0000-0000-0000-000000000002` | `08b463f8-...` | `settings` | `UPDATE` | `1731580245000.00001.iphone_expo_app` | `2` |

---

## 11. Materialized View: `mv_leaderboard`

```sql
SELECT user_id, username, solved_count, total_score, total_submissions, rank FROM mv_leaderboard LIMIT 3;
```

| `user_id` | `username` | `solved_count` | `total_score` | `total_submissions` | `rank` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `08b463f8-...` | `user_00001` | `38` | `82` | `112` | `1` |
| `14c27891-...` | `user_00084` | `36` | `77` | `98` | `2` |
| `29f44102-...` | `user_00312` | `34` | `71` | `89` | `3` |
