import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import type { DsaApi, Submission } from './api/dsa-api';
import type { NetworkStatus } from './adapters/types';
import { createSubmissionStore } from './stores';
import { createSyncStore, pendingCount } from './sync';

function fakeNetwork(online = true) {
  const listeners = new Set<(o: boolean) => void>();
  const net: NetworkStatus & { set(o: boolean): void } = {
    isOnline: () => online,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    set(o) {
      online = o;
      listeners.forEach((l) => l(o));
    },
  };
  return net;
}

const judged = (id: string, passed: number, total = 2): Submission =>
  ({
    id,
    problemId: 'p',
    userId: 'u',
    status: 'judged',
    passed,
    total,
    createdAt: '',
    judgedAt: '',
  }) as Submission;

/** A server that is down while `net` is offline and judges `passed` tests otherwise. */
function fakeApi(net: { isOnline(): boolean }, passed = 2) {
  const seen = new Map<string, string>(); // idempotency key → submission id
  const down = () => {
    if (!net.isOnline()) throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
  };
  return {
    seen,
    submit: vi.fn(async (_b: { problemId: string }, key?: string) => {
      down();
      if (!seen.has(key!)) seen.set(key!, `s${seen.size + 1}`);
      return { submissionId: seen.get(key!)!, status: 'queued' };
    }),
    submission: vi.fn(async (id: string) => (down(), judged(id, passed))),
  } as unknown as DsaApi & { seen: Map<string, string>; submit: ReturnType<typeof vi.fn> };
}

const setup = (o: { online?: boolean; passed?: number; user?: string | null } = {}) => {
  const net = fakeNetwork(o.online ?? false);
  const api = fakeApi(net, o.passed);
  const onSynced = vi.fn();
  let user = o.user === undefined ? 'u' : o.user;
  const sync = createSyncStore(api, {
    network: net,
    currentUser: () => user,
    onSynced,
    pollMs: 0,
    sleep: async () => {},
  });
  return { net, api, sync, onSynced, signIn: (u: string) => (user = u) };
};

/** Resolves when the store reaches a state matching `done`. */
const until = <T>(
  store: { getState(): T; subscribe(l: (s: T) => void): () => void },
  done: (s: T) => boolean
) =>
  new Promise<T>((resolve) => {
    if (done(store.getState())) return resolve(store.getState());
    const off = store.subscribe((s) => done(s) && (off(), resolve(s)));
  });

describe('sync outbox', () => {
  it('queues an offline submit and replays it on reconnect: pending → syncing → synced', async () => {
    const { net, api, sync, onSynced } = setup();
    const sub = createSubmissionStore(api, { onOffline: (s) => sync.getState().enqueue(s) });
    expect(sync.getState().status).toBe('offline');

    await sub.getState().submit('p', 'code');
    expect(sub.getState().status).toBe('queued');
    expect(pendingCount(sync.getState())).toBe(1);
    const key = sync.getState().queue[0].key;

    const seen: string[] = [];
    sync.subscribe((s) => seen.push(`${s.status}/${s.queue[0]?.state}`));
    net.set(true);
    const done = await until(sync, (s) => s.queue[0].state === 'synced' && s.status === 'online');
    expect(done.queue[0].server).toMatchObject({ status: 'judged', passed: 2, total: 2 });
    expect(seen).toContain('syncing/syncing');
    expect(api.submit).toHaveBeenLastCalledWith({ problemId: 'p', code: 'code' }, key); // the original key
    expect(pendingCount(done)).toBe(0);
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it('flags a conflict when the server disagrees with the offline verdict', async () => {
    const { net, sync } = setup({ passed: 1 });
    sync.getState().enqueue({ problemId: 'p', code: 'c', local: { passed: 2, total: 2 } });
    net.set(true);
    const s = await until(sync, (x) => x.queue[0].state === 'conflict');
    expect(s.queue[0].message).toMatch(/Offline run passed 2\/2, the server judged 1\/2/);
  });

  it('marks a 4xx refusal as rejected and keeps going', async () => {
    const { net, api, sync } = setup();
    api.submit.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Problem not found'));
    sync.getState().enqueue({ problemId: 'gone', code: 'c' });
    sync.getState().enqueue({ problemId: 'p', code: 'c' });
    net.set(true);
    const s = await until(sync, (x) => x.queue[1].state === 'synced');
    expect(s.queue[0]).toMatchObject({
      state: 'rejected',
      message: expect.stringMatching(/Problem not found/),
    });
    sync.getState().clearFinished();
    expect(sync.getState().queue).toEqual([]);
  });

  it('keeps items pending and reports an error on a 5xx, then Sync now retries', async () => {
    const { net, api, sync } = setup({ online: true });
    api.submit.mockRejectedValueOnce(new ApiError(503, 'UNAVAILABLE', 'Server busy'));
    sync.getState().enqueue({ problemId: 'p', code: 'c' });
    await sync.getState().syncNow();
    expect(sync.getState()).toMatchObject({ status: 'error', lastError: 'Server busy' });
    expect(sync.getState().queue[0].state).toBe('pending');
    await sync.getState().syncNow();
    expect(sync.getState().queue[0].state).toBe('synced');
    expect(net.isOnline()).toBe(true);
  });

  it("waits for a session, and never replays another user's queue", async () => {
    const { net, sync, signIn } = setup({ user: null });
    sync.getState().enqueue({ problemId: 'p', code: 'guest' }); // desktop offline guest: userId null
    net.set(true);
    await until(sync, (s) => s.status === 'error');
    expect(sync.getState().lastError).toMatch(/Sign in/);
    signIn('other');
    sync.setState((s) => ({ queue: [...s.queue, { ...s.queue[0], key: 'k2', userId: 'u' }] }));
    await sync.getState().syncNow();
    expect(sync.getState().queue.map((q) => q.state)).toEqual(['synced', 'pending']);
  });

  it('runs one sync at a time', async () => {
    const { api, sync } = setup({ online: true });
    sync.getState().enqueue({ problemId: 'p', code: 'c' });
    await Promise.all([sync.getState().syncNow(), sync.getState().syncNow()]);
    expect(api.submit).toHaveBeenCalledOnce();
  });

  it('persists the queue', async () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const api = fakeApi({ isOnline: () => false });
    createSyncStore(api, { storage, currentUser: () => 'u' })
      .getState()
      .enqueue({ problemId: 'p', code: 'c' });
    const again = createSyncStore(api, { storage, currentUser: () => 'u' });
    expect(again.getState().queue).toHaveLength(1);
  });
});

describe('sync wording', () => {
  it('summarises status and items', async () => {
    const { syncSummary, describeQueued } = await import('./sync');
    const q = {
      key: 'k',
      problemId: 'p',
      code: '',
      userId: 'u',
      queuedAt: '',
      state: 'pending' as const,
    };
    expect(syncSummary({ status: 'offline', queue: [q] })).toBe('Offline · 1 queued');
    expect(syncSummary({ status: 'syncing', queue: [q] })).toBe('Syncing 1…');
    expect(syncSummary({ status: 'online', queue: [] })).toBe('Online');
    expect(
      describeQueued({
        ...q,
        state: 'synced',
        server: { submissionId: 's', status: 'judged', passed: 2, total: 2 },
      })
    ).toBe('Synced · Accepted 2/2');
    expect(
      describeQueued({
        ...q,
        state: 'conflict',
        server: { submissionId: 's', status: 'judged', passed: 1, total: 2 },
      })
    ).toBe('Conflict · Wrong answer 1/2');
  });
});
