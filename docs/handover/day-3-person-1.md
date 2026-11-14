# Handover — Day 3, Person 1

## What was built

Day 3 — Code-execution sandbox for judging user submissions. All on `main` (no branches).

## Sandbox decision: `/docs/sandbox-decision.md`

Compared `child_process`, `worker_threads`, `vm` (standalone), and `isolated-vm` on:

- Isolation/security
- Memory limits
- Timeouts
- Performance
- Windows/macOS/Linux portability
- Electron compatibility

**Chosen: `child_process` + `vm` inside each child.** Rationale: `vm` alone is explicitly not a security boundary per Node docs; `isolated-vm` is a native addon with poor Electron compatibility; `worker_threads` shares the OS process. `child_process` gives a separate OS process (killable, memory-limited, fully isolated) and works identically on Windows/macOS/Linux and in Electron.

## Core engine — `/core` (pure TS, no HTTP/DB)

**New module: `src/sandbox.ts`** — `submitCodeSandbox(problem, userCode, options)`

- Runs each test case in its own isolated `child_process`
- Each child runs `src/sandbox-exec.js` which uses `vm` with a restricted context (no `require`, `process`, `fs`, `network`; `process.exit` not exposed; null-prototype sandbox object)
- Per-test timeout (default 2s) via `execFileSync` timeout (hard kill → infinite-loop protection)
- Total timeout across all test cases
- Memory limit via `NODE_OPTIONS=--max-old-space-size`
- Output-size cap (default 50KB), truncates captured `console.log`
- Captures console output and thrown errors

**Result shape** (from `types.ts`):

```ts
interface ExecutionResult {
  problemId: string;
  status: 'passed' | 'failed' | 'error' | 'timeout';
  perTest: PerTestResult[];
}
interface PerTestResult {
  id: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  runtimeMs: number;
  error?: string;
  output?: string;
}
```

**Storage interfaces** (unchanged from Day 2, still not implemented — Person 2):
`ProblemRepository`, `SubmissionRepository`, `UserRepository`, `StatsRepository`

**Existing modules updated:** `executor.ts` now delegates to `submitCodeSandbox`; `index.ts` barrel exports `sandbox`.

## Workers — `/workers`

**New module: `src/sandbox/sandbox-runner.ts`** — `runSubmissionSandbox(job)` wraps `submitCodeSandbox` for BullMQ job processing.
**Updated:** `src/index.ts` — BullMQ worker now calls `runSubmissionSandbox` and returns the `ExecutionResult`. Depends on `@dsa-portal/core`.

## CLI — `/cli`

Updated to consume the new `ExecutionResult` shape (`status`, `perTest[]`).

## Verification (real execution)

- `npm install` — OK
- `npx tsc -p core` / `tsc -p workers` / `tsc -p cli` — clean
- `npx eslint core/ cli/ workers/` — 0 errors (37 warnings: console statements, `any` type — acceptable)
- `npx jest --coverage` — 41/41 tests pass
  - Coverage on `/core`: statements 95.75%, branches 85.5%, functions 96.77%, lines 97.88% (all ≥80%)
- Security tests all contained: infinite loop → timeout, memory bomb → contained, `process.exit` → error, `require('fs')` → error, prototype pollution → failed (contained), huge console output → truncated, `require('http')` → error
- Normal solution → passed with correct per-test results

## Branch / push

- All work committed directly on `main` (no person/day branches, per instruction).
- Push to `https://github.com/dipu01-code/DSA_Portal.git` (origin/main).

## Next (Day 4)

- Person 1: implement `/server/src/modules/{problems,hints,solutions,submissions,...}` consuming `@dsa-portal/core`, per `/docs/openapi.yaml`.
- Person 2: implement storage interfaces (`/server/src/db` PostgreSQL, `/core/src/storage` SQLite), sync, `/infra` (Docker).
- Person 3: `/web`, `/desktop`, `/mobile`, `/ui-core`, `/server/src/modules/{auth,admin,stats}`, `/server/src/cache`.
- Any endpoint/table/event change → log in `/docs/CHANGE_REQUESTS.md` first.
