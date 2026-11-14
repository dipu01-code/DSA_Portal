import type { Problem, RunResult } from '@dsa-portal/ui-core';

/**
 * "Run" in the browser: the user's own code against the visible test cases, in a throwaway Web
 * Worker so an infinite loop can't freeze the page (terminated after the time limit). Grading
 * ("Submit") always happens on the server sandbox; this only gives quick feedback.
 */
const WORKER_SRC = `
const MAX_LOG_LINES = 200;
const show = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v); } catch { return String(v); } };
self.onmessage = (e) => {
  const { code, tests } = e.data;
  const results = tests.map((t, i) => {
    // console.* output of this test case only (capped), and how long solve() took.
    const logs = [];
    const capture = (...a) => { if (logs.length < MAX_LOG_LINES) logs.push(a.map(show).join(' ')); };
    console.log = console.info = console.warn = console.error = console.debug = capture;
    const started = performance.now();
    const timeMs = () => Math.round((performance.now() - started) * 100) / 100;
    try {
      const solve = new Function(code + '\\n;return typeof solve === "function" ? solve : undefined;')();
      if (typeof solve !== 'function') throw new Error('Define a function named solve(input)');
      const actual = JSON.stringify(solve(JSON.parse(t.input)));
      return { testCaseIndex: i, passed: actual === JSON.stringify(JSON.parse(t.expected)), actual: String(actual), expected: t.expected, logs, timeMs: timeMs() };
    } catch (err) {
      return { testCaseIndex: i, passed: false, actual: '', expected: t.expected, error: String(err && err.message || err), logs, timeMs: timeMs() };
    }
  });
  self.postMessage(results);
};`;

/** A test row as the browser runner reports it: RunResult's row plus console output and time. */
export type RunRow = RunResult['results'][number] & { logs?: string[]; timeMs?: number };
export type BrowserRunResult = Omit<RunResult, 'results'> & { results: RunRow[] };

export function runInWorker(
  problem: Problem,
  code: string,
  timeoutMs = 3000
): Promise<BrowserRunResult> {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const finish = () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finish();
      resolve({
        passed: 0,
        total: problem.testCases.length,
        results: problem.testCases.map((t, i) => ({
          testCaseIndex: i,
          passed: false,
          actual: '',
          expected: t.expected,
          error: `Time limit (${timeoutMs} ms) exceeded`,
        })),
      });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<RunRow[]>) => {
      clearTimeout(timer);
      finish();
      resolve({
        passed: e.data.filter((r) => r.passed).length,
        total: e.data.length,
        results: e.data,
      });
    };
    worker.postMessage({ code, tests: problem.testCases });
  });
}
