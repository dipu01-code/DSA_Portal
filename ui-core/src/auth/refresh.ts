import type { SecureStorage } from '../adapters/types';

const REFRESH_PATH = '/api/v1/auth/refresh';
export const REFRESH_TOKEN_KEY = 'dsa.refreshToken';

/**
 * Browser: the HttpOnly `refresh_token` cookie is sent and rotated by the browser itself. The web app
 * talks to the API on its own origin (Vite proxy / reverse proxy), so default fetch credentials suffice.
 */
export const browserRefresh =
  (baseUrl: string, doFetch: typeof fetch = fetch) =>
  async (): Promise<string | null> => {
    const res = await doFetch(`${baseUrl}${REFRESH_PATH}`, { method: 'POST' });
    return res.ok ? ((await res.json()) as { accessToken: string }).accessToken : null;
  };

/**
 * Desktop main process / React Native: no cookie jar, so the refresh token lives in SecureStorage
 * and is sent as a Cookie header. The rotated token comes back in Set-Cookie and replaces it.
 */
export const nativeRefresh =
  (baseUrl: string, storage: SecureStorage, doFetch: typeof fetch = fetch) =>
  async (): Promise<string | null> => {
    const token = await storage.get(REFRESH_TOKEN_KEY);
    if (!token) return null;
    const res = await doFetch(`${baseUrl}${REFRESH_PATH}`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${token}` },
    });
    const rotated = res.headers.get('set-cookie')?.match(/refresh_token=([^;]*)/)?.[1];
    if (!res.ok) {
      if (res.status === 401) await storage.remove(REFRESH_TOKEN_KEY);
      return null;
    }
    if (rotated) await storage.set(REFRESH_TOKEN_KEY, rotated);
    return ((await res.json()) as { accessToken: string }).accessToken;
  };
