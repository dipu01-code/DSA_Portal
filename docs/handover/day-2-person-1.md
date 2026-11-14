# Handover — Day 2, Person 1

## What was built

Day 2 — Core engine as a pure TypeScript library, plus a CLI entry point that consumes it. All on `main` (no branches).

## /core — pure TS library (no HTTP, no database)

**Exported API and types** (from `core/src/index.ts`):

- `Difficulty` — `'Easy' | 'Medium' | 'Hard'`
- `Topic` — `'Arrays' | 'Strings' | 'LinkedList' | 'Trees' | 'Graphs' | 'Dynamic Programming' | 'Sorting' | 'Searching'`
- `TestCase` — `{ input: unknown; expected: unknown }`
- `Hint` — `{ level: number; content: string }`
- `Solution` — `{ code: string; explanation?: string }`
- `Problem` — full problem record (id, title, topic, difficulty, description, starterCode, testCases[], hints[], solution)
- `ExecutionResult` — `{ problemId, passed, total, results[] }` with per-case passed/actual/expected/error
- `Submission` — `{ id, problemId, userId, code, status, result?, createdAt }`, status `queued|running|judged|failed`
- `User` — `{ id, username, email, role, createdAt }`

**Modules:**

- `problem.schema.ts` — zod schema (`ProblemSchema`, `TestCaseSchema`, `HintSchema`, `SolutionSchema`) + `validateProblem(input)` for validating JSON problem files. `ProblemInput` inferred type.
- `problem-loader.ts` — `loadProblems(dir)` reads + validates all `*.json` files; `loadProblemById(dir, id)`; `filterProblems(problems, filters)`.
- `random-selector.ts` — `selectRandomProblem(problems, {topic, difficulty, recentIds})` picks a random eligible problem, preferring ones not recently seen, falling back to the full pool. Returns `null` when nothing matches.
- `hint-service.ts` — `HintService` with `getHint(problem, level)`, `getHintsUpTo`, `getNextHintLevel`, `hasMoreHints` (progressive, level 1..n).
- `solution-service.ts` — `SolutionService.getSolution(problem)` returns the reference solution.
- `executor.ts` — `submitCode({problem, userCode})` runs user JS in a `child_process` against predefined test cases, returns `ExecutionResult`. Pure logic, no HTTP/DB.
- `problems.ts` — loads the 3 sample problems from `core/problems/*.json` (two-sum, palindrome-number, merge-two-sorted-lists) + `getProblem`, `getRandomProblem`, `listProblems`.

**Storage interfaces (Person 2 implements — NOT implemented here):**

- `ProblemRepository` — `findById`, `findAll(filters)`, `save`
- `SubmissionRepository` — `save`, `findById`, `findByUser`
- `UserRepository` — `findById`, `findByUsername`, `save`
- `StatsRepository` — `getUserStats`, `getTopicStats`

These are pure interfaces in `core/src/types.ts`. Core has zero database/HTTP dependencies. Person 2 implements them for PostgreSQL (server) and SQLite (local/offline).

## /cli — terminal entry point

New workspace package `@dsa-portal/cli` (`cli/package.json`, `cli/tsconfig.json`, `cli/src/index.ts`). Interactive readline menu: choose topic → difficulty → random problem → view/stubmit/hints/solution. Tracks solved/attempted stats in memory. Uses `@dsa-portal/core` only.

Added `cli` to root npm workspaces. Build: `tsc` → `cli/dist/index.js` (bin: `dsa`).

## Verification (real execution)

- `npm install` — OK
- `npx tsc -p core/tsconfig.json` — clean
- `npx tsc -p cli/tsconfig.json` — clean
- `npx eslint core/ --ext .ts` — 0 errors
- `npx jest --coverage` — 30/30 tests pass; coverage: statements 94.3%, branches 82.5%, functions 96.4%, lines 98.1% (all ≥80% threshold)
- `npx tsc -p server/tsconfig.json` — clean (unchanged)

## Branch / push

- All work committed directly on `main` (no person/day branches, per your instruction).
- Pushed to `https://github.com/dipu01-code/DSA_Portal.git` (origin/main).

## Next (Day 3)

- Person 1: implement `/server/src/modules/{problems,hints,solutions,submissions,...}` consuming `@dsa-portal/core`, per `/docs/openapi.yaml`.
- Person 2: implement the storage interfaces (`/server/src/db` PostgreSQL, `/core/src/storage` SQLite), sync, `/infra` (Docker).
- Person 3: `/web`, `/desktop`, `/mobile`, `/ui-core`, `/server/src/modules/{auth,admin,stats}`, `/server/src/cache`.
- Any endpoint/table/event change → log in `/docs/CHANGE_REQUESTS.md` first.
