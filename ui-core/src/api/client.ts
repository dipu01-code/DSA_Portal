/** Every failure (HTTP error, network, bad JSON) becomes this one shape, mirroring the server's `Error` body. */
export class ApiError extends Error {
  constructor(
    public status: number, // 0 = network failure
    public code: string,
    message: string,
    public requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  /** '' for same origin (web behind a proxy), or e.g. 'http://localhost:3000'. */
  baseUrl: string;
  /**
   * Gets a new access token after a 401, or null if the session is gone. Platform-specific:
   * the browser relies on the HttpOnly cookie, desktop/mobile send their stored refresh token.
   */
  refresh: () => Promise<string | null>;
  /** Called once refreshing fails, so the auth store can show the login screen. */
  onAuthLost?: () => void;
  fetch?: typeof fetch;
  /** Retries for idempotent GETs on network errors, 429 and 5xx. */
  retry?: { attempts: number; baseDelayMs: number };
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  /** false for login/register/topics: no bearer token and no refresh on 401. */
  auth?: boolean;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createApiClient(cfg: ApiClientConfig) {
  const doFetch = cfg.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const retry = cfg.retry ?? { attempts: 3, baseDelayMs: 300 };
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let accessToken: string | null = null;
  let refreshing: Promise<string | null> | null = null;

  /** Single flight: concurrent 401s share one refresh call (a second call would trip reuse detection). */
  function refreshOnce(): Promise<string | null> {
    refreshing ??= cfg
      .refresh()
      .catch(() => null)
      .then((token) => {
        accessToken = token;
        if (!token) cfg.onAuthLost?.();
        return token;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  function url(path: string, query?: RequestOptions['query']) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.append(k, String(v)); // append, not set: React Native's URLSearchParams has no set()
    const s = qs.toString();
    return `${cfg.baseUrl}${path}${s ? `?${s}` : ''}`;
  }

  async function send(method: string, path: string, o: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...o.headers };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.auth !== false && accessToken) headers.authorization = `Bearer ${accessToken}`;
    return doFetch(url(path, o.query), {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  }

  async function toError(res: Response): Promise<ApiError> {
    const requestId = res.headers.get('x-request-id') ?? undefined;
    try {
      const body = await res.json();
      return new ApiError(
        res.status,
        body.error ?? 'HTTP_ERROR',
        body.message ?? res.statusText,
        requestId
      );
    } catch {
      return new ApiError(
        res.status,
        'HTTP_ERROR',
        res.statusText || `HTTP ${res.status}`,
        requestId
      );
    }
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const attempts = method === 'GET' ? retry.attempts : 1;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await send(method, path, o);
        if (res.status === 401 && o.auth !== false && (await refreshOnce())) {
          res = await send(method, path, o);
        }
      } catch (err) {
        if (attempt < attempts) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new ApiError(
          0,
          'NETWORK_ERROR',
          err instanceof Error ? err.message : 'Network request failed'
        );
      }
      if (RETRYABLE.has(res.status) && attempt < attempts) {
        await sleep(backoff(attempt));
        continue;
      }
      if (!res.ok) throw await toError(res);
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
  }

  /** Exponential backoff with full jitter: 0..base*2^(n-1). */
  const backoff = (attempt: number) => Math.random() * retry.baseDelayMs * 2 ** (attempt - 1);

  return {
    request,
    setAccessToken: (t: string | null) => {
      accessToken = t;
    },
    getAccessToken: () => accessToken,
    refresh: refreshOnce,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
