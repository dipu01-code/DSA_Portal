import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExecutionResult, PerTestResult, Problem, TestCase } from './types';

export interface SandboxOptions {
  perTestTimeoutMs?: number;
  totalTimeoutMs?: number;
  memoryLimitMb?: number;
  outputCap?: number;
  /** Binary that runs the child. Desktop passes process.execPath + ELECTRON_RUN_AS_NODE so no Node install is needed (CR-018). */
  nodePath?: string;
  /** Extra env for the child. PATH and NODE_OPTIONS (the memory limit) cannot be overridden. */
  extraEnv?: Record<string, string>;
}

const execFileAsync = promisify(execFile);

const DEFAULTS: Required<SandboxOptions> = {
  perTestTimeoutMs: 2000,
  totalTimeoutMs: 30000,
  memoryLimitMb: 64,
  outputCap: 50000,
  nodePath: 'node',
  extraEnv: {},
};

/**
 * Path to the sandbox wrapper script executed inside each child process.
 * Lives next to this file in both src/ and dist/ (copied by tsc allowJs).
 */
const SANDBOX_EXEC_PATH = path.join(__dirname, 'sandbox-exec.js');

/**
 * Writes user code and all test inputs to their own temp files. User code is never pasted
 * into the wrapper's source, so it cannot break out into host-side code.
 */
function prepareFiles(userCode: string, inputs: unknown[]) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-sandbox-'));
  const codePath = path.join(tmpDir, 'code.js');
  const inputPath = path.join(tmpDir, 'inputs.json');
  fs.writeFileSync(codePath, userCode);
  fs.writeFileSync(inputPath, JSON.stringify(inputs));
  return {
    codePath,
    inputPath,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * node args + options for one sandboxed child that runs `testCount` tests. Shared by the sync and async
 * runners (exported for tests).
 */
export function childCommand(
  codePath: string,
  inputPath: string,
  options: Required<SandboxOptions>,
  testCount = 1
) {
  // Node's permission model as a second wall behind the vm: even code that escaped the context could only
  // read the wrapper and this submission's own files (no fs writes, no child processes, no worker threads).
  // Plain `node` only: Electron 28 (desktop, CR-018) is Node 18 and has no permission model.
  const permissions =
    options.nodePath === DEFAULTS.nodePath
      ? [
          '--experimental-permission',
          `--allow-fs-read=${SANDBOX_EXEC_PATH}`,
          `--allow-fs-read=${path.dirname(codePath)}`,
        ]
      : [];
  const args = [
    ...permissions,
    SANDBOX_EXEC_PATH,
    codePath,
    inputPath,
    String(options.outputCap),
    String(options.perTestTimeoutMs),
  ];
  const execOptions = {
    encoding: 'utf8' as const,
    // V8 stops each test at perTestTimeoutMs inside the child; killing the child is the backstop (+1 s for Node to start).
    timeout: Math.min(options.totalTimeoutMs, options.perTestTimeoutMs * testCount) + 1000,
    maxBuffer: (options.outputCap + 4096) * testCount,
    // Minimal env: never leak server secrets (JWT_SECRET, DATABASE_URL) or Jest IPC vars to untrusted code.
    env: {
      ...options.extraEnv,
      PATH: process.env.PATH,
      NODE_OPTIONS: `--max-old-space-size=${options.memoryLimitMb}`,
    },
  };
  return { args, execOptions };
}

/** Plain messages for learners; raw errors would also show server file paths. */
function crashMessage(
  err: unknown,
  options: Required<SandboxOptions>,
  timeoutMs: number,
  elapsedMs: number
) {
  const e = err as { message?: string; code?: unknown; signal?: string | null };
  // Measured, not guessed from exit codes: an out-of-memory crash or an oversized result
  // also kills the child, but long before the time limit.
  if (elapsedMs >= timeoutMs) return `Test timed out after ${options.perTestTimeoutMs}ms`;
  if (/maxBuffer|ENOBUFS/.test(`${e.code} ${e.message}`)) return 'Output too large';
  if (e.signal) return `Crashed (${e.signal}), most likely out of memory`;
  return e.message ?? String(err);
}

/**
 * The child prints one JSON line per finished test. If it died (`err`), the tests it finished keep their
 * results, the one it was running gets the reason, and the rest were never run.
 */
function toResults(
  tcs: TestCase[],
  options: Required<SandboxOptions>,
  timeoutMs: number,
  stdout: string,
  err?: unknown,
  elapsedMs = 0
): PerTestResult[] {
  const lines = stdout.split('\n').slice(0, -1); // only newline-terminated lines are complete
  return tcs.map((tc, i) => {
    const base = {
      id: tc.id ?? `test-${i}`,
      passed: false,
      expected: tc.expected,
      actual: undefined as unknown,
      runtimeMs: 0,
    };
    const line = lines[i];
    if (line === undefined) {
      if (i > lines.length) {
        return { ...base, error: 'Not run: the sandbox stopped at an earlier test' };
      }
      return {
        ...base,
        error:
          err === undefined
            ? 'No result from the sandbox'
            : crashMessage(err, options, timeoutMs, elapsedMs),
      };
    }
    if (line.length > options.outputCap + 4096) return { ...base, error: 'Output too large' };
    const parsed = JSON.parse(line);
    if (parsed.status === 'timeout') {
      return { ...base, error: `Test timed out after ${options.perTestTimeoutMs}ms` };
    }
    const result = {
      ...base,
      runtimeMs: parsed.runtimeMs ?? 0,
      actual: parsed.result,
      output: parsed.output,
    };
    if (parsed.status === 'error' || parsed.error) return { ...result, error: parsed.error };
    const passed = deepEqual(parsed.result, tc.expected);
    return passed
      ? { ...result, passed }
      : {
          ...result,
          error: `Expected ${JSON.stringify(tc.expected)}, got ${JSON.stringify(parsed.result)}`,
        };
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

/** Overall verdict: timeout > error (no result produced) > failed (wrong answer) > passed. */
function finish(problem: Problem, results: PerTestResult[]): ExecutionResult {
  const crashed = results.filter((r) => r.error && r.actual === undefined);
  let status: ExecutionResult['status'] = 'passed';
  if (crashed.some((r) => /timed out|Total timeout/.test(r.error ?? ''))) status = 'timeout';
  else if (crashed.length) status = 'error';
  else if (results.some((r) => !r.passed)) status = 'failed';
  return { problemId: problem.id, status, perTest: results };
}

/**
 * Runs user code against all test cases in one sandboxed child process (a fresh vm context per test).
 * Blocks the calling thread; used by the CLI and the desktop app. Result shape: { status, perTest: [...] }
 */
export function submitCodeSandbox(
  problem: Problem,
  userCode: string,
  options: SandboxOptions = {}
): ExecutionResult {
  const cfg = { ...DEFAULTS, ...options };
  const { codePath, inputPath, cleanup } = prepareFiles(
    userCode,
    problem.testCases.map((tc) => tc.input)
  );
  const { args, execOptions } = childCommand(codePath, inputPath, cfg, problem.testCases.length);
  const started = Date.now();
  try {
    // Drop child stderr so untrusted code (or an OOM crash dump) cannot flood the host's logs.
    const stdout = execFileSync(cfg.nodePath, args, {
      ...execOptions,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return finish(problem, toResults(problem.testCases, cfg, execOptions.timeout, stdout));
  } catch (err) {
    const stdout = String((err as { stdout?: unknown }).stdout ?? '');
    return finish(
      problem,
      toResults(problem.testCases, cfg, execOptions.timeout, stdout, err, Date.now() - started)
    );
  } finally {
    cleanup();
  }
}

/** Same as submitCodeSandbox but never blocks the event loop (used by the worker). */
export async function submitCodeSandboxAsync(
  problem: Problem,
  userCode: string,
  options: SandboxOptions = {}
): Promise<ExecutionResult> {
  const cfg = { ...DEFAULTS, ...options };
  const { codePath, inputPath, cleanup } = prepareFiles(
    userCode,
    problem.testCases.map((tc) => tc.input)
  );
  const { args, execOptions } = childCommand(codePath, inputPath, cfg, problem.testCases.length);
  const started = Date.now();
  try {
    // execFile buffers stderr in memory (capped by maxBuffer); it never reaches the host's logs.
    const { stdout } = await execFileAsync(cfg.nodePath, args, execOptions);
    return finish(problem, toResults(problem.testCases, cfg, execOptions.timeout, stdout));
  } catch (err) {
    const stdout = String((err as { stdout?: unknown }).stdout ?? '');
    return finish(
      problem,
      toResults(problem.testCases, cfg, execOptions.timeout, stdout, err, Date.now() - started)
    );
  } finally {
    cleanup();
  }
}
