import { describe, expect, it } from 'vitest';
import { ApiError } from './api/client';
import type { DsaApi, Problem } from './api/dsa-api';
import { storageLocalStore, withProblemCache } from './offline-cache';

const problem = (id: string, topic = 'Arrays', difficulty: Problem['difficulty'] = 'Easy') =>
  ({ id, title: id, topic, difficulty }) as Problem;
const memStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('withProblemCache', () => {
  function setup() {
    const local = storageLocalStore(memStorage());
    let online = true;
    const net = () => {
      if (!online) throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    };
    const http = {
      problem: async (id: string) => (net(), problem(id)),
      randomProblem: async () => (net(), problem('two-sum')),
      problems: async () => (net(), { data: [], nextCursor: null }),
      topics: async () => (net(), ['Arrays', 'Graphs']),
    } as unknown as DsaApi;
    return { api: withProblemCache(http, async () => local), goOffline: () => (online = false) };
  }

  it('caches problems that load, then lists, opens and picks them offline', async () => {
    const { api, goOffline } = setup();
    await api.problem('two-sum');
    await api.problem('graph-1');
    await flush();
    goOffline();
    expect(await api.problem('two-sum')).toMatchObject({ id: 'two-sum' });
    expect((await api.problems()).data.map((p) => p.id).sort()).toEqual(['graph-1', 'two-sum']);
    expect(await api.topics()).toEqual(['Arrays']);
    expect(await api.randomProblem({ topic: 'Arrays' })).toMatchObject({ id: expect.any(String) });
    await expect(api.problem('never-opened')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('does not hide real server errors behind the cache', async () => {
    const local = storageLocalStore(memStorage());
    await local.saveProblem(problem('two-sum'));
    const http = {
      problem: async () => {
        throw new ApiError(404, 'NOT_FOUND', 'Problem not found');
      },
    } as unknown as DsaApi;
    await expect(
      withProblemCache(http, async () => local).problem('two-sum')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('storageLocalStore', () => {
  it('filters by topic/difficulty and survives bad JSON', async () => {
    const s = memStorage();
    const store = storageLocalStore(s);
    await store.saveProblem(problem('a', 'Arrays', 'Easy'));
    await store.saveProblem(problem('b', 'Graphs', 'Hard'));
    expect((await store.listProblems({ difficulty: 'Hard' })).map((p) => p.id)).toEqual(['b']);
    expect(await store.getProblem('a')).toEqual(problem('a'));
    s.setItem('dsa.problems', '{oops');
    expect(await store.listProblems()).toEqual([]);
  });
});
