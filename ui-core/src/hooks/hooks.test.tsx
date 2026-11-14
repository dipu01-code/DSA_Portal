import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { mockServer } from '../mocks/node';
import { MOCK_PASSWORD, mockUser } from '../mocks/fixtures';
import { createDsa } from '../create-dsa';
import {
  DsaProvider,
  useAuth,
  useLeaderboard,
  useProblem,
  useStats,
  useSubmission,
  useSync,
} from './index';
import { ApiError } from '../api/client';
import { errorMessage } from '../stores';

const BASE = 'http://api.test';
const { server } = mockServer(BASE);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

describe('hooks against the mock server', () => {
  const dsa = createDsa({ baseUrl: BASE, pollMs: 1 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DsaProvider value={dsa}>{children}</DsaProvider>
  );

  it('useAuth logs in and re-renders', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(() => result.current.login(mockUser.email, MOCK_PASSWORD));
    expect(result.current).toMatchObject({ status: 'authenticated', user: { username: 'demo' } });
  });

  it('useProblem + useSubmission solve a problem', async () => {
    const { result } = renderHook(() => ({ p: useProblem(), s: useSubmission() }), { wrapper });
    await act(() => result.current.p.load('two-sum'));
    expect(result.current.p.problem?.title).toBe('Two Sum');
    await act(() => result.current.s.submit('two-sum', 'function solve() { return [0, 1]; }'));
    expect(result.current.s).toMatchObject({ status: 'done', current: { passed: 2 } });
  });

  it('useStats loads on mount', async () => {
    const { result } = renderHook(() => useStats(), { wrapper });
    await waitFor(() => expect(result.current.summary).toMatchObject({ solved: 1, attempted: 1 }));
    expect(result.current.streak?.currentStreak).toBe(1);
  });

  it('useLeaderboard loads entries', async () => {
    const { result } = renderHook(() => useLeaderboard(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('useLeaderboard pages with Load more (Day 9 bug 7)', async () => {
    const { result } = renderHook(() => useLeaderboard(2), { wrapper });
    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.nextCursor).toBe('2');
    await act(() => result.current.loadMore());
    expect(result.current.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(result.current.nextCursor).toBeNull();
  });

  it("useSync hides another user's queued code (Day 9 bug 2)", () => {
    const me = dsa.stores.auth.getState().user!.id;
    const q = { code: 'x', problemId: 'two-sum', queuedAt: '', state: 'pending' as const };
    dsa.stores.sync.setState({
      queue: [
        { ...q, key: 'mine', userId: me },
        { ...q, key: 'guest', userId: null },
        { ...q, key: 'theirs', userId: 'someone-else' },
      ],
    });
    const { result } = renderHook(() => useSync(), { wrapper });
    expect(result.current.queue.map((x) => x.key)).toEqual(['mine', 'guest']);
    dsa.stores.sync.setState({ queue: [] });
  });

  it("logging out clears the last user's stats, problem and result (Day 9 bug 1)", async () => {
    expect(dsa.stores.stats.getState().summary).not.toBeNull();
    await act(() => dsa.stores.problem.getState().load('two-sum'));
    await act(() => dsa.stores.auth.getState().logout());
    expect(dsa.stores.stats.getState().summary).toBeNull();
    expect(dsa.stores.problem.getState().problem).toBeNull();
    expect(dsa.stores.submission.getState()).toMatchObject({ status: 'idle', current: null });
  });

  it('network failures read as a sentence, not "Failed to fetch" (Day 9 bug 4)', () => {
    expect(errorMessage(new ApiError(0, 'NETWORK_ERROR', 'Failed to fetch'))).toBe(
      'No connection to the server. Check your network and try again.'
    );
    expect(errorMessage(new ApiError(404, 'NOT_FOUND', 'Problem not found'))).toBe(
      'Problem not found'
    );
    expect(errorMessage(new ApiError(429, 'QUOTA_EXCEEDED', 'Too many submissions'))).toMatch(
      /submission limit/
    );
  });

  it('hooks outside the provider fail loudly', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/DsaProvider/);
  });
});
