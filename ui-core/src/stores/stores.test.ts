import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockServer } from '../mocks/node';
import { MOCK_PASSWORD, mockUser } from '../mocks/fixtures';
import { createDsa } from '../create-dsa';
import { createSettingsStore } from './index';

const BASE = 'http://api.test';
const { server, mock } = mockServer(BASE);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  mock.state.hasSession = false;
  mock.state.accessToken = null;
  mock.state.solved.clear();
  mock.state.attempted.clear();
});
afterAll(() => server.close());

const fresh = () => createDsa({ baseUrl: BASE, pollMs: 1, retry: { attempts: 1, baseDelayMs: 0 } });
const loggedIn = async () => {
  const dsa = fresh();
  expect(await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD)).toBe(true);
  return dsa;
};

describe('auth store', () => {
  it('logs in and loads the user', async () => {
    const { stores } = await loggedIn();
    expect(stores.auth.getState()).toMatchObject({
      status: 'authenticated',
      user: { username: 'demo' },
      error: null,
      busy: false,
    });
  });
  it('shows the server message on a failed login', async () => {
    const { stores } = fresh();
    expect(await stores.auth.getState().login(mockUser.email, 'nope')).toBe(false);
    expect(stores.auth.getState()).toMatchObject({
      status: 'unknown',
      error: 'Invalid email or password',
    });
  });
  it('restore() uses the refresh cookie to get back in, or ends anonymous', async () => {
    const a = fresh();
    await a.stores.auth.getState().restore();
    expect(a.stores.auth.getState().status).toBe('anonymous');
    mock.state.hasSession = true;
    const b = fresh();
    await b.stores.auth.getState().restore();
    expect(b.stores.auth.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: mockUser.id },
    });
  });
  it('an expired access token is refreshed transparently; a dead session logs out', async () => {
    const dsa = await loggedIn();
    mock.expireAccessToken();
    expect((await dsa.api.me()).username).toBe('demo');
    mock.expireAccessToken();
    mock.state.hasSession = false;
    await expect(dsa.api.me()).rejects.toMatchObject({ status: 401 });
    expect(dsa.stores.auth.getState().status).toBe('anonymous');
  });
  it('register logs the new user in; logout clears everything', async () => {
    const { stores, client } = fresh();
    expect(await stores.auth.getState().register('newbie', 'new@dsa.dev', MOCK_PASSWORD)).toBe(
      true
    );
    expect(stores.auth.getState().status).toBe('authenticated');
    await stores.auth.getState().logout();
    expect(stores.auth.getState()).toMatchObject({ status: 'anonymous', user: null });
    expect(client.getAccessToken()).toBeNull();
    expect(mock.state.hasSession).toBe(false);
  });
  it('native hooks receive tokens and replace the HTTP logout', async () => {
    const onTokens = vi.fn(async () => {});
    const onLogout = vi.fn(async () => {});
    const dsa = createDsa({ baseUrl: BASE, onTokens, onLogout });
    await dsa.stores.auth.getState().login(mockUser.email, MOCK_PASSWORD);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'mock-refresh' })
    );
    await dsa.stores.auth.getState().logout();
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('problem store', () => {
  it('loads a random problem for the filters, with starter code', async () => {
    const { stores } = await loggedIn();
    stores.problem.getState().setFilters('Strings', 'Medium');
    await stores.problem.getState().loadRandom();
    expect(stores.problem.getState()).toMatchObject({
      problem: { id: 'longest-substring' },
      loading: false,
      error: null,
    });
    expect(stores.problem.getState().code).toContain('function solve');
  });
  it('explains an empty filter result', async () => {
    const { stores } = await loggedIn();
    stores.problem.getState().setFilters('Trees', 'Hard');
    await stores.problem.getState().loadRandom();
    expect(stores.problem.getState().error).toBe('No problem matches these filters');
  });
  it('reveals hints one at a time; the solution stays locked until solved', async () => {
    const dsa = await loggedIn();
    const p = dsa.stores.problem;
    await p.getState().load('valid-anagram');
    await p.getState().nextHint();
    await p.getState().nextHint();
    expect(p.getState().hints).toHaveLength(2);
    await p.getState().revealSolution();
    expect(p.getState()).toMatchObject({
      solution: null,
      error: 'Solve the problem first to unlock its solution',
    });

    await dsa.stores.submission
      .getState()
      .submit('valid-anagram', 'function solve({ x }) { return x; }');
    await p.getState().revealSolution();
    expect(p.getState().solution).toContain('function solve');
  });
});

describe('submission + stats stores', () => {
  it('submits, polls until judged, then reloads stats', async () => {
    const dsa = await loggedIn();
    const sub = dsa.stores.submission;
    await sub.getState().submit('two-sum', 'function solve({ nums, target }) { return [0, 1]; }');
    expect(sub.getState()).toMatchObject({
      status: 'done',
      current: { status: 'judged', passed: 2, total: 2 },
    });
    await vi.waitFor(() =>
      expect(dsa.stores.stats.getState().summary).toMatchObject({ solved: 1 })
    );
  });
  it('a wrong answer is judged with per-test results', async () => {
    const dsa = await loggedIn();
    await dsa.stores.submission.getState().submit('two-sum', '// WRONG');
    const s = dsa.stores.submission.getState().current!;
    expect([s.passed, s.total, s.results?.[0].passed]).toEqual([0, 2, false]);
  });
  it('reports errors (unknown problem) and can be reset', async () => {
    const { stores } = await loggedIn();
    await stores.submission.getState().submit('nope', 'x');
    expect(stores.submission.getState()).toMatchObject({
      status: 'error',
      error: 'Problem not found',
    });
    stores.submission.getState().reset();
    expect(stores.submission.getState().status).toBe('idle');
  });
  it('stats load summary and streak, and surface errors', async () => {
    const dsa = await loggedIn();
    await dsa.stores.stats.getState().load();
    expect(dsa.stores.stats.getState()).toMatchObject({
      summary: { totalProblems: 5 },
      streak: { days: [] },
      error: null,
    });
    dsa.client.setAccessToken(null);
    mock.state.hasSession = false;
    await dsa.stores.stats.getState().load();
    expect(dsa.stores.stats.getState().error).toMatch(/access token/);
  });
});

describe('settings store', () => {
  it('persists to the given storage and clamps the font size', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    const s = createSettingsStore(storage);
    s.getState().setTheme('dark');
    s.getState().setEditorFontSize(99);
    expect(s.getState()).toMatchObject({ theme: 'dark', editorFontSize: 28 });
    const again = createSettingsStore(storage);
    expect(again.getState().theme).toBe('dark');
  });
});
