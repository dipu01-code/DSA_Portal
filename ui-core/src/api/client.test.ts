import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './client';
import { nativeRefresh } from '../auth/refresh';
import { memorySecureStorage } from '../adapters/web';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** fetch fake: 401 unless the bearer token is "good"; counts calls. */
function fakeServer() {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    const auth = (init.headers as Record<string, string>).authorization;
    return auth === 'Bearer good'
      ? json(200, { ok: true })
      : json(401, { error: 'UNAUTHORIZED', message: 'no' });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe('API client', () => {
  it('attaches the bearer token, refreshes once on 401 and replays the request', async () => {
    const { fetch, calls } = fakeServer();
    const refresh = vi.fn(async () => 'good');
    const client = createApiClient({ baseUrl: 'http://x', fetch, refresh });
    client.setAccessToken('stale');
    expect(await client.request('GET', '/a', { query: { n: 1, skip: undefined } })).toEqual({
      ok: true,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['GET http://x/a?n=1', 'GET http://x/a?n=1']);
    expect(client.getAccessToken()).toBe('good');
  });

  it('single-flight: many concurrent 401s share one refresh', async () => {
    const { fetch } = fakeServer();
    let release!: (t: string) => void;
    const refresh = vi.fn(() => new Promise<string>((r) => (release = r)));
    const client = createApiClient({ baseUrl: '', fetch, refresh });
    const all = Promise.all([1, 2, 3, 4, 5].map((i) => client.request('GET', `/r${i}`)));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    release('good');
    expect(await all).toHaveLength(5);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reports auth loss when the refresh fails, and throws the 401', async () => {
    const { fetch } = fakeServer();
    const onAuthLost = vi.fn();
    const client = createApiClient({ baseUrl: '', fetch, refresh: async () => null, onAuthLost });
    await expect(client.request('GET', '/a')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(onAuthLost).toHaveBeenCalledTimes(1);
  });

  it('does not refresh for auth:false calls (login)', async () => {
    const { fetch } = fakeServer();
    const refresh = vi.fn(async () => 'good');
    const client = createApiClient({ baseUrl: '', fetch, refresh });
    await expect(
      client.request('POST', '/login', { auth: false, body: {} })
    ).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retries idempotent GETs on 503 and network errors with backoff, never POSTs', async () => {
    const sleep = vi.fn(async () => {});
    let n = 0;
    const fetch = vi.fn(async () => {
      n++;
      if (n === 1) throw new TypeError('socket hang up');
      if (n === 2) return json(503, { error: 'X', message: 'busy' });
      return json(200, { n });
    }) as unknown as typeof globalThis.fetch;
    const client = createApiClient({
      baseUrl: '',
      fetch,
      refresh: async () => null,
      sleep,
      retry: { attempts: 3, baseDelayMs: 100 },
    });
    expect(await client.request('GET', '/a')).toEqual({ n: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    for (const [ms] of sleep.mock.calls as unknown as number[][]) {
      expect(ms).toBeLessThanOrEqual(200);
    }

    n = 1; // next call returns 503 once
    await expect(client.request('POST', '/a', { body: {} })).rejects.toMatchObject({
      status: 503,
      message: 'busy',
    });
  });

  it('normalises network failures and non-JSON errors', async () => {
    const down = createApiClient({
      baseUrl: '',
      refresh: async () => null,
      retry: { attempts: 1, baseDelayMs: 0 },
      fetch: (async () => {
        throw new TypeError('offline');
      }) as unknown as typeof fetch,
    });
    await expect(down.request('GET', '/a')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'offline',
    });
    const html = createApiClient({
      baseUrl: '',
      refresh: async () => null,
      retry: { attempts: 1, baseDelayMs: 0 },
      fetch: (async () =>
        new Response('<h1>bad gateway</h1>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'x-request-id': 'r1' },
        })) as unknown as typeof fetch,
    });
    await expect(html.request('GET', '/a')).rejects.toMatchObject({
      status: 502,
      code: 'HTTP_ERROR',
      message: 'Bad Gateway',
      requestId: 'r1',
    });
  });
});

describe('nativeRefresh', () => {
  it('sends the stored token as a cookie and keeps the rotated one', async () => {
    const storage = memorySecureStorage();
    await storage.set('dsa.refreshToken', 'old');
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).cookie).toBe('refresh_token=old');
      return json(
        200,
        { accessToken: 'a1' },
        { 'set-cookie': 'refresh_token=new; Max-Age=604800; Path=/api/v1/auth; HttpOnly' }
      );
    }) as unknown as typeof globalThis.fetch;
    expect(await nativeRefresh('http://x', storage, fetch)()).toBe('a1');
    expect(await storage.get('dsa.refreshToken')).toBe('new');
  });
  it('forgets a rejected token and returns null', async () => {
    const storage = memorySecureStorage();
    await storage.set('dsa.refreshToken', 'stolen');
    const fetch = (async () =>
      json(401, { error: 'UNAUTHORIZED' })) as unknown as typeof globalThis.fetch;
    expect(await nativeRefresh('', storage, fetch)()).toBeNull();
    expect(await storage.get('dsa.refreshToken')).toBeNull();
  });
});
