import { app, utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  HintService,
  selectRandomProblem,
  type Difficulty,
  type ExecutionResult,
  type Problem as CoreProblem,
  type Topic,
} from '@dsa-portal/core';
import type { Problem as ApiProblem, RunResult, Submission } from '@dsa-portal/ui-core';
import { SEED_PROBLEMS } from '../../server/src/db/seeds/problems-data';

/**
 * The offline half of the desktop app: /core picks problems and gives hints, core's sandbox judges
 * in a utility process. Problems are the 40 seed problems bundled into the app.
 * Offline submissions reach the server through the renderer's sync outbox (ui-core/src/sync.ts).
 * shortcut: solved ids live in a JSON file in userData until Person 2's SQLite storage exists (CR-030).
 */
export function createOfflineEngine(problems: CoreProblem[] = SEED_PROBLEMS) {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const hints = new HintService();
  const progressFile = () => path.join(app.getPath('userData'), 'offline-progress.json');
  let progress: { solved: string[] } | null = null;
  const loadProgress = () => {
    if (progress) return progress;
    try {
      progress = JSON.parse(fs.readFileSync(progressFile(), 'utf8'));
    } catch {
      progress = { solved: [] };
    }
    return progress!;
  };
  const saveProgress = () => fs.promises.writeFile(progressFile(), JSON.stringify(progress));

  // Same mapping as the server's toApiProblem: test values become JSON strings.
  const toApi = (p: CoreProblem): ApiProblem => ({
    id: p.id,
    title: p.title,
    topic: p.topic,
    difficulty: p.difficulty,
    description: p.description,
    starterCode: p.starterCode,
    testCases: p.testCases.map((t) => ({
      input: JSON.stringify(t.input),
      expected: JSON.stringify(t.expected),
    })),
    hints: [...p.hints].sort((a, b) => a.level - b.level).map((h) => h.content),
    solution: '', // the solution is only handed out by solution() once solved
  });

  let worker: UtilityProcess | null = null;
  let nextId = 0;
  const pending = new Map<number, { resolve(r: ExecutionResult): void; reject(e: Error): void }>();
  function sandbox(): UtilityProcess {
    if (worker) return worker;
    worker = utilityProcess.fork(path.join(__dirname, 'sandbox-worker.js'), [], {
      serviceName: 'dsa-sandbox',
    });
    worker.on('message', (m: { id: number; result?: ExecutionResult; error?: string }) => {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.result) p?.resolve(m.result);
      else p?.reject(new Error(m.error ?? 'sandbox failed'));
    });
    worker.on('exit', () => {
      worker = null;
      for (const p of pending.values()) {
        p.reject(new Error('The sandbox process stopped unexpectedly'));
      }
      pending.clear();
    });
    return worker;
  }
  const judge = (problem: CoreProblem, code: string) =>
    new Promise<ExecutionResult>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      // The app's own Electron binary runs each test as plain Node: no Node install needed (CR-018).
      sandbox().postMessage({ id, problem, code, nodePath: process.execPath });
    });

  const get = (id: string) => {
    const p = byId.get(id);
    if (!p) throw new Error(`Unknown problem ${id}`);
    return p;
  };
  const toResults = (r: ExecutionResult) =>
    r.perTest.map((t, testCaseIndex) => ({
      testCaseIndex,
      passed: t.passed,
      expected: JSON.stringify(t.expected),
      actual: t.actual === undefined ? '' : JSON.stringify(t.actual),
      ...(t.error ? { error: t.error } : {}),
    }));

  return {
    topics: async () => [...new Set(problems.map((p) => p.topic))],
    randomProblem: async (q: { topic?: string; difficulty?: Difficulty }) => {
      const p = selectRandomProblem(problems, {
        topic: q.topic as Topic | undefined,
        difficulty: q.difficulty,
      });
      return p ? toApi(p) : null;
    },
    problem: async (id: string) => (byId.has(id) ? toApi(get(id)) : null),
    hints: async (id: string, upto: number) =>
      hints.getHintsUpTo(get(id), upto).map((h) => h.content),
    solution: async (id: string) =>
      loadProgress().solved.includes(id) ? get(id).solution.code : null,
    async run(problemId: string, code: string): Promise<RunResult> {
      const results = toResults(await judge(get(problemId), code));
      return { passed: results.filter((r) => r.passed).length, total: results.length, results };
    },
    async submit(problemId: string, code: string): Promise<Submission> {
      const r = await judge(get(problemId), code);
      const results = toResults(r);
      const now = new Date().toISOString();
      const s: Submission = {
        id: randomUUID(),
        problemId,
        userId: 'offline',
        status: 'judged',
        passed: results.filter((x) => x.passed).length,
        total: results.length,
        results,
        createdAt: now,
        judgedAt: now,
      };
      const prog = loadProgress();
      if (r.status === 'passed' && !prog.solved.includes(problemId)) prog.solved.push(problemId);
      await saveProgress();
      return s;
    },
    dispose: () => worker?.kill(),
  };
}
