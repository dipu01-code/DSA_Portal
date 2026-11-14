import { ApiError } from './api/client';
import type { DsaApi, Problem, ProblemSummary } from './api/dsa-api';
import type { LocalStore } from './adapters/types';

const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;

/**
 * Problems the user opens are saved locally; when the network is down they can still be listed,
 * opened and picked at random. Only network failures fall back: real server errors still show.
 * Used by web (localStorage) and mobile (expo-sqlite); desktop has its own bundled offline engine.
 */
export function withProblemCache(http: DsaApi, local: () => Promise<LocalStore>): DsaApi {
  const cached = async <T extends { id: string }>(
    load: () => Promise<T>,
    fallback: () => Promise<Problem | null>
  ) => {
    try {
      const p = await load();
      void local()
        .then((s) => s.saveProblem(p as never))
        .catch(() => {});
      return p;
    } catch (e) {
      const hit = isOffline(e) ? await fallback() : null;
      if (hit) return hit as unknown as T;
      throw e;
    }
  };
  return {
    ...http,
    problem: (id) =>
      cached(
        () => http.problem(id),
        async () => (await local()).getProblem(id)
      ),
    randomProblem: (q) =>
      cached(
        () => http.randomProblem(q),
        async () => {
          const s = await local();
          const pool = await s.listProblems(q);
          return pool.length
            ? s.getProblem(pool[Math.floor(Math.random() * pool.length)].id)
            : null;
        }
      ),
    async problems(q) {
      try {
        return await http.problems(q);
      } catch (e) {
        if (!isOffline(e)) throw e;
        return { data: await (await local()).listProblems(q), nextCursor: null };
      }
    },
    async topics() {
      try {
        return await http.topics();
      } catch (e) {
        if (!isOffline(e)) throw e;
        return [...new Set((await (await local()).listProblems()).map((p) => p.topic))];
      }
    },
  };
}

/**
 * LocalStore over a synchronous key-value Storage (window.localStorage on web).
 * shortcut: one JSON blob, fine for the few hundred problems a user opens; move to IndexedDB if it grows past ~2 MB.
 */
export function storageLocalStore(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key = 'dsa.problems'
): LocalStore {
  const read = (): Record<string, Problem & { savedAt: number }> => {
    try {
      return JSON.parse(storage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  };
  return {
    async saveProblem(p) {
      const all = read();
      all[p.id] = { ...p, savedAt: Date.now() };
      storage.setItem(key, JSON.stringify(all));
    },
    getProblem: async (id) => {
      const p = read()[id];
      if (!p) return null;
      const { savedAt: _, ...problem } = p;
      return problem;
    },
    listProblems: async (f = {}) =>
      Object.values(read())
        .filter(
          (p) =>
            (!f.topic || p.topic === f.topic) && (!f.difficulty || p.difficulty === f.difficulty)
        )
        .sort((a, b) => b.savedAt - a.savedAt)
        .map(({ id, title, topic, difficulty }): ProblemSummary => ({
          id,
          title,
          topic,
          difficulty,
        })),
  };
}
