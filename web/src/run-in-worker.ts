import type { Problem, RunResult } from '@dsa-portal/ui-core';

/**
 * "Run" in the browser: the user's own code against the visible test cases, in a throwaway Web
 * Worker so an infinite loop can't freeze the page (terminated after the time limit). Grading
 * ("Submit") always happens on the server sandbox; this only gives quick feedback.
 */
const WORKER_SRC = `
self.onmessage = (e) => {
  const { code, tests } = e.data;
  const results = tests.map((t, i) => {
    try {
      const solve = new Function(code + '\\n;return typeof solve === "function" ? solve : undefined;')();
      if (typeof solve !== 'function') throw new Error('Define a function named solve(input)');
      const actual = JSON.stringify(solve(JSON.parse(t.input)));
      return { testCaseIndex: i, passed: actual === JSON.stringify(JSON.parse(t.expected)), actual: String(actual), expected: t.expected };
    } catch (err) {
      return { testCaseIndex: i, passed: false, actual: '', expected: t.expected, error: String(err && err.message || err) };
    }
  });
  self.postMessage(results);
};`;

export function runInWorker(problem: Problem, code: string, timeoutMs = 3000): Promise<RunResult> {
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
    worker.onmessage = (e: MessageEvent<RunResult['results']>) => {
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
