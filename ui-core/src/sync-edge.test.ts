/**
 * Sync edge cases as the user lives them, on the full client (createDsa) against the mock API:
 * offline for a long time (access token expired meanwhile), the session ending while offline,
 * and two tabs replaying the same queue.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mockServer } from './mocks/node';
import { MOCK_PASSWORD, mockUser } from './mocks/fixtures';
import { createDsa } from './create-dsa';
import { pendingCount } from './sync';
import type { NetworkStatus } from './adapters/types';

const BASE = 'http://edge.test';
const { server, mock } = mockServer(BASE);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function device(storage = memoryStorage()) {
  const listeners = new Set<(o: boolean) => void>();
  let online = true;
  const network: NetworkStatus = {
    isOnline: () => online,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  const dsa = createDsa({
    baseUrl: BASE,
    network,
    settingsStorage: storage,
    pollMs: 1,
    retry: { attempts: 1, baseDelayMs: 0 },
  });
  const setOnline = (o: boolean) => {
    online = o;
    if (o) server.resetHandlers();
    else server.use(http.all(`${BASE}/*`, () => HttpResponse.error())); // the cable is out
    listeners.forEach((l) => l(o));
  };
  return { dsa, setOnline, storage };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const until = (check: () => boolean, ms = 3000) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () =>
      check()
        ? resolve()
        : Date.now() - t0 > ms
          ? reject(new Error('timed out'))
          : setTimeout(tick, 5);
    tick();
  });

const solve = 'function solve() { return [0, 1]; }';

describe('sync edge cases', () => {
  it('offline for a long time: several submits queue in order; the expired access token is refreshed once and all replay', async () => {
    const { dsa, setOnline } = device();
    await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    setOnline(false);
    for (const id of ['two-sum', 'valid-anagram', 'two-sum']) {
      await dsa.stores.submission.getState().submit(id, solve);
    }
    expect(dsa.stores.submission.getState().status).toBe('queued');
    expect(pendingCount(dsa.stores.sync.getState())).toBe(3);

    mock.expireAccessToken(); // hours later: the 15-minute access token is long gone
    const refreshes = mock.state.refreshCalls;
    setOnline(true);
    await until(() => dsa.stores.sync.getState().queue.every((q) => q.state === 'synced'));
    expect(dsa.stores.sync.getState().queue.map((q) => q.problemId)).toEqual([
      'two-sum',
      'valid-anagram',
      'two-sum',
    ]);
    expect(mock.state.refreshCalls - refreshes).toBe(1);
    expect(dsa.stores.sync.getState().status).toBe('online');
  });

  it('session ended while offline: the queue is kept, the user is asked to sign in, and signing in syncs it', async () => {
    const { dsa, setOnline } = device();
    await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    setOnline(false);
    await dsa.stores.submission.getState().submit('two-sum', solve);
    mock.state.hasSession = false; // refresh token expired or revoked meanwhile
    mock.expireAccessToken();
    setOnline(true);
    await until(() => dsa.stores.sync.getState().status === 'error');
    expect(dsa.stores.sync.getState().lastError).toMatch(/Sign in to sync/);
    expect(dsa.stores.sync.getState().queue[0].state).toBe('pending');
    expect(dsa.stores.auth.getState().status).toBe('anonymous');

    await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    await until(() => dsa.stores.sync.getState().queue[0].state === 'synced');
  });

  it('a reconnect in the middle of a sync does not lose or duplicate anything', async () => {
    const { dsa, setOnline } = device();
    await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    setOnline(false);
    await dsa.stores.submission.getState().submit('two-sum', solve);
    await dsa.stores.submission.getState().submit('valid-anagram', solve);
    const before = mock.state.submissions.size;
    setOnline(true);
    setOnline(false); // flaky Wi-Fi
    setOnline(true);
    await until(() => dsa.stores.sync.getState().queue.every((q) => q.state === 'synced'));
    expect(mock.state.submissions.size - before).toBe(2);
  });

  it('two tabs sharing one outbox replay the same item: the Idempotency-Key keeps it to one submission', async () => {
    const shared = memoryStorage();
    const a = device(shared);
    await a.dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    a.setOnline(false);
    await a.dsa.stores.submission.getState().submit('two-sum', solve);
    const before = mock.state.submissions.size;

    server.resetHandlers(); // the connection is back...
    const b = device(shared); // ...and a second tab opens, reading the same persisted queue
    expect(b.dsa.stores.sync.getState().queue).toHaveLength(1);
    // Both tabs replay at once: B because it just signed in, A because it saw the reconnect.
    await Promise.all([
      b.dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD),
      a.setOnline(true),
    ]);
    await until(() =>
      [a, b].every((t) => t.dsa.stores.sync.getState().queue[0].state === 'synced')
    );
    expect(mock.state.submissions.size - before).toBe(1);
  });
});
