import type { ExecutionResult, PerTestResult } from './types';

/** Rebuilds the overall verdict from stored per-test rows (same rules as the sandbox). */
export function verdictOf(perTest: PerTestResult[]): ExecutionResult['status'] {
  const crashed = perTest.filter((t) => t.error && t.actual === undefined);
  if (crashed.some((t) => /timed out|timeout/i.test(t.error ?? ''))) return 'timeout';
  if (crashed.length) return 'error';
  return perTest.length > 0 && perTest.every((t) => t.passed) ? 'passed' : 'failed';
}
