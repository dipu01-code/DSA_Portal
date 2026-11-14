import { describe, expect, it } from '@jest/globals';
import { childCommand, submitCodeSandbox, submitCodeSandboxAsync } from '../src/sandbox';
import { spawnSync } from 'child_process';
import os from 'os';
import { loadProblems } from '../src/problem-loader';

import path from 'path';
const PROBLEMS_DIR = path.join(__dirname, '..', 'problems');

const problems = loadProblems(PROBLEMS_DIR);
const twoSum = problems.find((p) => p.id === 'two-sum')!;

const correctCode = `
function solve(input) {
  const { nums, target } = input;
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) return [map.get(complement), i];
    map.set(nums[i], i);
  }
  return [];
}
`;

const wrongCode = `function solve(input) { return [0, 0]; }`;

describe('sandbox — normal solution', () => {
  it('passes a correct two-sum submission', () => {
    const result = submitCodeSandbox(twoSum, correctCode, {
      perTestTimeoutMs: 2000,
      totalTimeoutMs: 10000,
      memoryLimitMb: 64,
      outputCap: 50000,
    });
    expect(result.problemId).toBe('two-sum');
    expect(result.status).toBe('passed');
    expect(result.perTest.length).toBe(twoSum.testCases.length);
    expect(result.perTest.every((r) => r.passed)).toBe(true);
    expect(result.perTest.every((r) => r.runtimeMs >= 0)).toBe(true);
  });

  it('fails an incorrect submission', () => {
    const result = submitCodeSandbox(twoSum, wrongCode, {
      perTestTimeoutMs: 2000,
      totalTimeoutMs: 10000,
      memoryLimitMb: 64,
      outputCap: 50000,
    });
    expect(result.status).toBe('failed');
    expect(result.perTest.some((r) => !r.passed)).toBe(true);
    expect(result.perTest.every((r) => r.error)).toBe(true);
  });

  it('captures expected and actual values on failure', () => {
    const result = submitCodeSandbox(twoSum, wrongCode, {
      perTestTimeoutMs: 2000,
      totalTimeoutMs: 10000,
      memoryLimitMb: 64,
      outputCap: 50000,
    });
    const failed = result.perTest.find((r) => !r.passed)!;
    expect(failed.expected).toBeDefined();
    expect(failed.actual).toBeDefined();
    expect(failed.error).toBeDefined();
  });
});

describe('sandbox — security (hostile samples must be contained)', () => {
  const shortTimeout = {
    perTestTimeoutMs: 1500,
    totalTimeoutMs: 10000,
    memoryLimitMb: 64,
    outputCap: 50000,
  };

  it('contains an infinite loop (timeout)', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { while (true) {} return 1; }`,
      shortTimeout
    );
    expect(result.status).toBe('timeout');
    expect(result.perTest.some((r) => r.error && r.error.includes('timed out'))).toBe(true);
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
  });

  it('contains a memory allocation bomb', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { const a = []; while (true) { a.push(new Array(1000000).fill('x')); } return 1; }`,
      { ...shortTimeout, memoryLimitMb: 32 }
    );
    // Should be contained: either timeout or error, never passed
    expect(result.status).not.toBe('passed');
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
  });

  it('contains process.exit (process not in sandbox)', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { process.exit(0); return 1; }`,
      shortTimeout
    );
    expect(result.status).toBe('error');
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
    expect(result.perTest.every((r) => r.error)).toBe(true);
  });

  it("contains require('fs') (require not in sandbox)", () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { require('fs'); return 1; }`,
      shortTimeout
    );
    expect(result.status).toBe('error');
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
    expect(result.perTest.every((r) => r.error)).toBe(true);
  });

  it('contains prototype pollution attempt', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { Object.prototype.polluted = true; return input; }`,
      shortTimeout
    );
    // Contained: child process isolated, pollution does not reach parent.
    // solve() returns input (not the two-sum answer), so it fails — but
    // crucially it is NOT an error/timeout, meaning the sandbox contained it.
    expect(result.status).toBe('failed');
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
  });

  it('contains huge console output (output cap)', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { for (let i = 0; i < 100000; i++) { console.log('x'); } return 1; }`,
      { ...shortTimeout, outputCap: 1000 }
    );
    // Should be contained — output truncated, not passed (wrong answer anyway)
    expect(result.status).not.toBe('passed');
    const truncated = result.perTest.some(
      (r) => r.output && r.output.includes('[output truncated]')
    );
    expect(truncated).toBe(true);
  });

  it('does not allow network access', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve(input) { const http = require('http'); return 1; }`,
      shortTimeout
    );
    expect(result.status).toBe('error');
    expect(result.perTest.every((r) => !r.passed)).toBe(true);
  });
});

describe('sandbox — escape attempts (must never reach the real process)', () => {
  const shortTimeout = {
    perTestTimeoutMs: 1500,
    totalTimeoutMs: 10000,
    memoryLimitMb: 64,
    outputCap: 50000,
  };
  const tryEscape = (expr: string) =>
    `function solve(input) { try { const P = ${expr}; return P && typeof P.pid === 'number' ? 'ESCAPED' : 'contained'; } catch (e) { return 'contained'; } }`;

  it.each([
    ['host function constructor via console.log', "console.log.constructor('return process')()"],
    [
      'host function constructor via input object',
      "input.constructor.constructor('return process')()",
    ],
    ['global object constructor', "this.constructor.constructor('return process')()"],
    ['context Function from a string', "(function(){}).constructor('return process')()"],
    ['an error object', "new Error().constructor.constructor('return process')()"],
  ])('blocks %s', (_name, expr) => {
    const result = submitCodeSandbox(twoSum, tryEscape(expr), shortTimeout);
    expect(result.perTest.map((r) => r.actual)).not.toContain('ESCAPED');
  });

  it('cannot break out of the wrapper source with a backtick', () => {
    const forge = "process.stdout.write(JSON.stringify({ status: 'ok', result: [0, 1] }));";
    const code = 'function solve() { return null; }`; ' + forge + ' process.exit(0); `';
    const result = submitCodeSandbox(twoSum, code, shortTimeout);
    expect(result.status).not.toBe('passed');
  });

  it('cannot forge a passing verdict by replacing JSON.stringify', () => {
    const code = `JSON.stringify = () => '{"status":"ok","result":[0,1]}'; function solve() { return null; }`;
    const result = submitCodeSandbox(twoSum, code, shortTimeout);
    expect(result.status).not.toBe('passed');
  });

  it("keeps user code containing $' and $& intact", () => {
    const result = submitCodeSandbox(twoSum, `const tag = "$' $&";\n${correctCode}`, shortTimeout);
    expect(result.status).toBe('passed');
  });

  it('keeps solutions declared with const working', () => {
    const result = submitCodeSandbox(
      twoSum,
      correctCode.replace('function solve(input)', 'const solve = (input) =>'),
      shortTimeout
    );
    expect(result.status).toBe('passed');
  });

  it('blocks eval / Function code generation inside the sandbox', () => {
    const result = submitCodeSandbox(
      twoSum,
      `function solve() { return Function('return 1')(); }`,
      shortTimeout
    );
    expect(result.perTest[0].error).toMatch(/Code generation from strings disallowed/);
  });

  it('cannot fake its own verdict through Object.prototype.toJSON', () => {
    const code = `Object.prototype.toJSON = function () { return { status: 'ok', result: [0, 1] }; }; function solve() { return null; }`;
    const result = submitCodeSandbox(twoSum, code, shortTimeout);
    expect(result.status).not.toBe('passed');
  });
});

describe('sandbox — async runner (used by the worker)', () => {
  const opts = { perTestTimeoutMs: 1000, totalTimeoutMs: 10000 };

  it('gives the same verdicts as the sync runner', async () => {
    expect((await submitCodeSandboxAsync(twoSum, correctCode, opts)).status).toBe('passed');
    expect((await submitCodeSandboxAsync(twoSum, wrongCode, opts)).status).toBe('failed');
    expect(
      (await submitCodeSandboxAsync(twoSum, `function solve() { throw new Error('boom'); }`, opts))
        .status
    ).toBe('error');
  });

  it('contains an infinite loop and an escape attempt', async () => {
    expect(
      (await submitCodeSandboxAsync(twoSum, `function solve() { while (true) {} }`, opts)).status
    ).toBe('timeout');
    const escape = `function solve() { try { return typeof console.log.constructor('return process')().pid; } catch (e) { return 'blocked'; } }`;
    const r = await submitCodeSandboxAsync(twoSum, escape, opts);
    expect(r.perTest.map((t) => t.actual)).not.toContain('number');
  });

  it('does not block the event loop: two slow submissions run in parallel', async () => {
    const slow = { ...twoSum, testCases: twoSum.testCases.slice(0, 1) };
    const loop = `function solve() { while (true) {} }`;
    const start = Date.now();
    await Promise.all([
      submitCodeSandboxAsync(slow, loop, opts),
      submitCodeSandboxAsync(slow, loop, opts),
    ]);
    // Sequential would take >= 2 x 1000 ms.
    expect(Date.now() - start).toBeLessThan(1900);
  });
});

describe('sandbox — failure labels', () => {
  const one = { ...twoSum, testCases: twoSum.testCases.slice(0, 1) };
  const opts = { perTestTimeoutMs: 2000, memoryLimitMb: 32 };
  const bomb = `function solve() { const a = []; while (true) { a.push(new Array(1e6).fill('x')); } }`;
  const huge = `function solve() { return 'x'.repeat(200000); }`;

  it.each([
    ['sync', (code: string) => Promise.resolve(submitCodeSandbox(one, code, opts))],
    ['async', (code: string) => submitCodeSandboxAsync(one, code, opts)],
  ])('%s: out of memory and oversized output are errors, not timeouts', async (_name, run) => {
    const oom = (await run(bomb)).perTest[0];
    expect(oom.error).toMatch(/out of memory/);
    expect((await run(bomb)).status).toBe('error');
    const big = await run(huge);
    expect(big.status).toBe('error');
    expect(big.perTest[0].error).toBe('Output too large');
  });
});

describe('nodePath / extraEnv (CR-018: desktop runs the child with its own binary)', () => {
  it('runs the child with the given binary and env', async () => {
    const result = await submitCodeSandboxAsync(twoSum, correctCode, {
      nodePath: process.execPath,
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(result.status).toBe('passed');
  });

  it('really uses nodePath: a missing binary fails every test instead of falling back to node', () => {
    const result = submitCodeSandbox(twoSum, correctCode, { nodePath: '/nonexistent/node' });
    expect(result.status).not.toBe('passed');
    expect(result.perTest.every((t) => !t.passed)).toBe(true);
  });

  it('cannot override the memory limit through extraEnv', async () => {
    const hog = 'function solve() { const a = []; while (true) a.push(new Array(1e6).fill(1)); }';
    const result = await submitCodeSandboxAsync(twoSum, hog, {
      extraEnv: { NODE_OPTIONS: '--max-old-space-size=4096' },
      perTestTimeoutMs: 5000,
    });
    // With the override honoured it would run until the 5 s timeout; the 64 MB cap kills it first.
    expect(result.status).toBe('error');
  }, 60000);
});

describe('Node permission model on the child (Day 8: reduced privileges)', () => {
  const opts = {
    perTestTimeoutMs: 2000,
    totalTimeoutMs: 30000,
    memoryLimitMb: 64,
    outputCap: 50000,
    nodePath: 'node',
    extraEnv: {},
  };
  const code = path.join(os.tmpdir(), 'dsa-sandbox-x', 'code.js');

  it('runs plain node with fs reads limited to the wrapper and the test dir', () => {
    const { args } = childCommand(code, code.replace('code.js', 'input.json'), opts);
    expect(args[0]).toBe('--experimental-permission');
    expect(args.filter((a) => a.startsWith('--allow-fs-read='))).toEqual([
      expect.stringMatching(/sandbox-exec\.js$/),
      `--allow-fs-read=${path.dirname(code)}`,
    ]);
    expect(args.some((a) => /allow-(fs-write|child-process|worker)/.test(a))).toBe(false);
  });

  it('those flags really block reading other files and spawning processes', () => {
    const { args } = childCommand(code, code, opts);
    const flags = args.filter((a) => a.startsWith('--'));
    for (const script of [
      'require("fs").readFileSync("/etc/hosts")',
      'require("child_process").execSync("id")',
    ]) {
      const r = spawnSync('node', [...flags, '-e', script], { encoding: 'utf8' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/ERR_ACCESS_DENIED|restricted/);
    }
  });

  it('leaves a custom binary (Electron, no permission model) without the flags', () => {
    expect(childCommand(code, code, { ...opts, nodePath: '/x/electron' }).args[0]).toMatch(
      /sandbox-exec\.js$/
    );
  });
});

describe('one child per submission (Day 9): a fresh context per test, failures stay per test', () => {
  const opts = { perTestTimeoutMs: 1000, totalTimeoutMs: 10000 };
  // Correct two-sum, except on the 2nd test case (nums [3,2,4]) where it misbehaves as given.
  const breaksOnSecond = (bad: string) =>
    `function solve({ nums, target }) { if (nums.length === 3) { ${bad} } const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }`;

  it('gives every test a fresh global scope (nothing carries over between tests)', async () => {
    const code =
      'globalThis.calls = (globalThis.calls || 0) + 1; var seen = calls; function solve() { return seen; }';
    const r = await submitCodeSandboxAsync(twoSum, code, opts);
    expect(r.perTest.map((t) => t.actual)).toEqual([1, 1, 1]);
  });

  it('a timeout in one test does not stop the others', async () => {
    const r = await submitCodeSandboxAsync(twoSum, breaksOnSecond('while (true) {}'), opts);
    expect(r.status).toBe('timeout');
    expect(r.perTest.map((t) => t.passed)).toEqual([true, false, true]);
    expect(r.perTest[1].error).toBe('Test timed out after 1000ms');
  });

  it('a crash keeps earlier results, names the crashing test, and marks the rest not run', () => {
    const r = submitCodeSandbox(
      twoSum,
      breaksOnSecond('const a = []; while (true) a.push(new Array(1e6).fill(1));'),
      { ...opts, memoryLimitMb: 32 }
    );
    expect(r.status).toBe('error');
    expect(r.perTest[0].passed).toBe(true);
    expect(r.perTest[1].error).toMatch(/out of memory/);
    expect(r.perTest[2].error).toMatch(/^Not run/);
  });

  it('contains an endless chain of promise jobs (microtasks count against the timeout)', async () => {
    const code =
      'function solve() { (function f() { Promise.resolve().then(f); })(); return [0, 1]; }';
    const r = await submitCodeSandboxAsync(
      { ...twoSum, testCases: twoSum.testCases.slice(0, 1) },
      code,
      opts
    );
    expect(r.status).toBe('timeout');
  });

  it('user code cannot replace the runner it can see on globalThis', async () => {
    const code =
      `for (const k of Object.getOwnPropertyNames(globalThis)) if (k.startsWith('__dsa_')) {` +
      ` try { globalThis[k] = () => '{"status":"ok","result":[0,1]}'; } catch (e) {}` +
      ` try { Object.defineProperty(globalThis, k, { value: () => 'x' }); } catch (e) {} }` +
      ` function solve() { return [9, 9]; }`;
    const r = await submitCodeSandboxAsync(twoSum, code, opts);
    expect(r.status).toBe('failed');
    expect(r.perTest.map((t) => t.actual)).toEqual([
      [9, 9],
      [9, 9],
      [9, 9],
    ]);
  });
});
