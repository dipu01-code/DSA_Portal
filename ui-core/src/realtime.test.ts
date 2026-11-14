// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { createRealtime, type Realtime } from './realtime';
import { createDsa } from './create-dsa';
import type { DsaApi, Submission } from './api/dsa-api';

let io: Server;
let url = '';
const tokens: unknown[] = [];

beforeAll(async () => {
  const http = createServer();
  io = new Server(http);
  // Like Person 1's gateway: the access token comes in the handshake; none → UNAUTHORIZED.
  io.use((s, next) => {
    tokens.push(s.handshake.auth.token);
    next(s.handshake.auth.token ? undefined : new Error('UNAUTHORIZED'));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => io.close());

const connected = (rt: Realtime) => vi.waitFor(() => expect(rt.connected()).toBe(true));
const finished = (submissionId: string, problemId = 'p') => ({
  submissionId,
  problemId,
  status: 'judged',
  passed: 1,
  total: 1,
});

describe('realtime (Socket.IO, docs/websocket-events.md)', () => {
  it('sends the access token in the handshake and resolves only its own submission:finished', async () => {
    const rt = createRealtime(url, () => 'tok-1');
    await connected(rt);
    expect(tokens).toContain('tok-1');
    const other = rt.waitForResult({ submissionId: 's2', problemId: 'p' }, 200);
    const mine = rt.waitForResult({ submissionId: 's1', problemId: 'p' }, 5000);
    io.emit('submission:running', { ...finished('s1'), status: 'running' }); // not the end yet
    io.emit('submission:finished', finished('s1'));
    expect(await mine).toBe(true);
    expect(await other).toBe(false); // same problem, other submission: not woken
    rt.close();
  });

  it('a rejected handshake (no token) stays disconnected without throwing', async () => {
    const rt = createRealtime(url, () => null);
    await new Promise((r) => setTimeout(r, 300));
    expect(rt.connected()).toBe(false);
    rt.close();
  });

  it('a pushed result ends the wait at once; with the socket gone the store still polls', async () => {
    let polls = 0;
    const judged = {
      id: 's1',
      problemId: 'p',
      userId: 'u',
      status: 'judged',
      passed: 1,
      total: 1,
      createdAt: '',
    } as Submission;
    const api = {
      submit: async () => ({ submissionId: 's1', status: 'queued' }),
      submission: async () => (++polls >= 2 ? judged : { ...judged, status: 'queued' }),
      stats: async () => ({}),
      streak: async () => ({}),
    } as unknown as DsaApi;

    // Socket up: the safety poll is 5 s, so finishing fast proves the push woke it.
    const live = createDsa({
      baseUrl: url,
      refresh: async () => null,
      wrapApi: () => api,
      realtime: createRealtime(url, () => 'tok'),
      pollMs: 60_000,
    });
    await connected(live.realtime!);
    const t0 = Date.now();
    const done = live.stores.submission.getState().submit('p', 'code');
    setTimeout(() => io.emit('submission:finished', finished('s1')), 100);
    await done;
    expect(live.stores.submission.getState().status).toBe('done');
    expect(Date.now() - t0).toBeLessThan(2000);
    live.realtime!.close();

    // No socket: plain polling at pollMs.
    polls = 0;
    const offline = createDsa({
      baseUrl: url,
      refresh: async () => null,
      wrapApi: () => api,
      pollMs: 5,
    });
    await offline.stores.submission.getState().submit('p', 'code');
    expect(offline.stores.submission.getState()).toMatchObject({
      status: 'done',
      current: { status: 'judged' },
    });
  });

  it('debounces leaderboard:updated, forwards daily:new and reports connection status', async () => {
    const rt = createRealtime(url, () => 'tok', undefined, 50);
    const status: boolean[] = [];
    rt.onStatus((c) => status.push(c));
    await connected(rt);
    const board = vi.fn();
    rt.onLeaderboardUpdate(board);
    const daily = new Promise<void>((r) => rt.onDailyNew(() => r()));
    for (let i = 0; i < 5; i++) io.emit('leaderboard:updated', { userId: 'u', problemId: 'p' });
    io.emit('daily:new', { date: '2026-11-14', problemId: 'two-sum' });
    await daily;
    await vi.waitFor(() => expect(board).toHaveBeenCalledTimes(1));
    io.disconnectSockets();
    await vi.waitFor(() => expect(status).toContain(false));
    rt.close();
  });
});
