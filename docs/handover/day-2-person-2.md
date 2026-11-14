# Handover — Day 2, Person 2

## What was built

Day 2 — Migrations, seeds, repository layer, and legacy CLI importer for the DSA Practice Platform.

All work committed to branch `person-2/day-2`.

---

## 1. Migration System (Up & Down)

- **`server/src/db/migrations/001_initial_schema.up.sql`**: Full forward DDL creating all 11 tables (`users`, `sessions`, `problems`, `test_cases`, `hints`, `solutions`, `submissions`, `user_problem_stats`, `daily_challenges`, `audit_log`, `sync_operations`), custom enum types (`user_role`, `difficulty`, `submission_status`), triggers for `updated_at`, and 12 query-optimized indexes.
- **`server/src/db/migrations/001_initial_schema.down.sql`**: Full rollback DDL dropping triggers, helper functions, all 11 tables with `CASCADE`, and custom enum types in reverse dependency order.
- **`server/src/db/migrate.ts`**: Idempotent migration runner that tracks executed migrations in the `_migrations` table within database transactions. Supports `up`, `down`, and `reset` (down then up).

---

## 2. 40 DSA Problems Dataset & Seed System

- **`server/src/db/seeds/problems-data.ts`**: Complete dataset of **40 problems** evenly distributed across all 8 topics (5 problems per topic) and all 3 difficulties:
  - **Arrays**: Two Sum (Easy), Best Time to Buy and Sell Stock (Easy), Contains Duplicate (Easy), Product of Array Except Self (Medium), Container With Most Water (Medium).
  - **Strings**: Valid Anagram (Easy), Valid Palindrome (Easy), Longest Substring Without Repeating Characters (Medium), Longest Common Prefix (Easy), String to Integer ATOI (Medium).
  - **LinkedList**: Reverse Linked List (Easy), Merge Two Sorted Lists (Easy), Linked List Cycle (Easy), Middle of the Linked List (Easy), Remove Nth Node From End (Medium).
  - **Trees**: Maximum Depth of Binary Tree (Easy), Invert Binary Tree (Easy), Same Tree (Easy), Binary Tree Level Order Traversal (Medium), Validate BST (Medium).
  - **Graphs**: Number of Islands (Medium), Flood Fill (Easy), Clone Graph (Medium), Course Schedule (Medium), Word Ladder (Hard).
  - **Dynamic Programming**: Climbing Stairs (Easy), Coin Change (Medium), House Robber (Medium), Longest Increasing Subsequence (Medium), Edit Distance (Hard).
  - **Sorting**: Merge Intervals (Medium), Sort Colors (Medium), Top K Frequent Elements (Medium), Kth Largest Element (Medium), Largest Number (Medium).
  - **Searching**: Binary Search (Easy), Search a 2D Matrix (Medium), Find Min in Rotated Sorted Array (Medium), Search in Rotated Sorted Array (Medium), Median of Two Sorted Arrays (Hard).
- Every problem includes:
  - Clear markdown description and JavaScript function signature (`solve(input)`).
  - **At least 5 test cases** with edge cases (empty inputs, single values, negative numbers, duplicates, and boundary limits).
  - **3 progressive hints** (Level 1: intuition $\rightarrow$ Level 2: data structure $\rightarrow$ Level 3: algorithm steps).
  - Reference JavaScript solution with detailed explanation explicitly documenting **Time Complexity: O(...)** and **Space Complexity: O(...)**.
- **Zod Schema Validation**: `seed.ts` validates every problem against `validateProblem()` from `@dsa-portal/core` before database writes.
- **Idempotency**: All problem inserts use `ON CONFLICT (slug) DO UPDATE` with transactional child refresh, making re-runs 100% safe.
- **Default Users Seeded**:
  - `admin@dsa.portal` (username: `admin`, password: `password123`, role: `admin`, UUID: `00000000-0000-0000-0000-000000000001`)
  - `student@dsa.portal` (username: `student`, password: `password123`, role: `user`, UUID: `00000000-0000-0000-0000-000000000002`)
- **Daily Challenge**: Automatically assigns today's challenge in `daily_challenges`.

---

## 3. Legacy CLI Importer

- **`server/src/db/import-legacy.ts`**: Automatically detects and scans legacy problem directories (`core/problems/` and `cli/problems/`), validates any found `.json` problems against the Zod schema, and ingests them into PostgreSQL without overwriting modern seed fields. Run via `npm run db:import-legacy`.

---

## 4. How to Run: From Empty to Fully Seeded

Start the local database and run the two commands:

```bash
# 1. Start PostgreSQL 16 & Redis 7 (if not already running)
npm run db:up

# Command 1: Run migrations
npm run db:migrate

# Command 2: Seed the 40 problems and default users
npm run db:seed
```

### Additional Available Database Scripts:

```bash
npm run db:reset          # Tears down DB, runs up migrations, and seeds
npm run db:migrate:down   # Rolls back all applied migrations
npm run db:import-legacy  # Ingests original CLI JSON problems
npm run db:down           # Stops the local Docker containers
```

---

## 5. Instructions for Person 1 (Backend & Worker)

1. **Repository Implementations**: Import from `@dsa-portal/server/src/db/repositories`:
   - `PostgresProblemRepository`: `findById(slugOrUuid)` returns full problem including test cases and hints; `findAll({ topic, difficulty })` supports filtering.
   - `PostgresSubmissionRepository`: `save(submission)` handles status transitions (`queued` $\rightarrow$ `running` $\rightarrow$ `judged`), persists results, and automatically updates `user_problem_stats`.
2. **Worker Integration**:
   When judging completes in `/workers`, call `submissionRepo.save(judgedSubmission)`. The repository atomically updates the submission and upserts `user_problem_stats`.

---

## 6. Instructions for Person 3 (Clients, Auth, Stats & Admin)

1. **Test User Accounts**:
   Use `admin@dsa.portal` or `student@dsa.portal` with password `password123` for login and testing.
2. **Repositories for Auth & Stats**:
   - `PostgresUserRepository`: `findById(id)`, `findByUsername(username)`, `save(user)`.
   - `PostgresStatsRepository`: `getUserStats(userId)` (returns attempted, solved, totalProblems, and daily streak) and `getTopicStats(userId)` (returns attempted and solved per topic).
3. **Daily Challenge**:
   The table `daily_challenges` contains today's featured problem (lookup by `challenge_date = CURRENT_DATE`).

---

## 7. Design Decisions & Trade-offs (for Viva)

1. **Raw SQL Up/Down Migrations with `_migrations` Tracker**:
   Instead of relying on heavy ORM abstractions, we wrote pure SQL DDL migrations with an idempotent `_migrations` metadata table running in ACID transactions. This provides complete visibility into constraints, indexes, and triggers, and is straightforward to defend in the viva.
2. **Idempotent Upsert Strategy**:
   Both problem seeding and user seeding utilize PostgreSQL `ON CONFLICT DO UPDATE` clauses with transactionally cleaned child relations (test cases, hints, solutions). This ensures developers and CI pipelines can run `npm run db:seed` repeatedly without primary key collisions or duplicate rows.
3. **Strict Zod Validation Barrier**:
   Every seed problem is validated against `@dsa-portal/core`'s Zod schema before touching the database, guaranteeing schema synchronization between the TypeScript domain types and database constraints.
4. **40-Problem Curriculum Coverage**:
   Rather than trivial dummy data, we implemented 40 classic problems across 8 topics with $\ge$5 test cases (covering negative numbers, empty arrays, single elements, and boundary values) and 3 progressive hints per problem, providing a real practice dataset from Day 2.
