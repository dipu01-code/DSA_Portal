import type {
  SyncPushRequest,
  SyncPushResponse,
  SyncPullRequest,
  SyncPullResponse,
  SyncBootstrapResponse,
} from './types';

/**
 * Transport abstraction for sync network requests.
 * Allows pluggable HTTP client, in-memory transport for unit testing, or WebSocket transport.
 */
export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(request: SyncPullRequest): Promise<SyncPullResponse>;
  bootstrap?(): Promise<SyncBootstrapResponse>;
}

/**
 * Standard HTTP fetch implementation of SyncTransport.
 */
export class HttpSyncTransport implements SyncTransport {
  constructor(
    private baseUrl: string,
    private getAuthToken?: () => string | Promise<string>
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.getAuthToken) {
      const token = await this.getAuthToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    return headers;
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    const headers = await this.getHeaders();
    const res = await fetch(`${this.baseUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Sync push failed with HTTP ${res.status}: ${errorText}`);
    }

    return (await res.json()) as SyncPushResponse;
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const headers = await this.getHeaders();
    const params = new URLSearchParams({
      cursor: String(request.cursor || 0),
      limit: String(request.limit || 100),
    });

    const res = await fetch(`${this.baseUrl}/api/v1/sync/pull?${params.toString()}`, {
      method: 'GET',
      headers,
    });

    if (res.status === 410) {
      const err = new Error('SYNC_CURSOR_EXPIRED');
      (err as any).code = 'SYNC_CURSOR_EXPIRED';
      throw err;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Sync pull failed with HTTP ${res.status}: ${errorText}`);
    }

    return (await res.json()) as SyncPullResponse;
  }

  async bootstrap(): Promise<SyncBootstrapResponse> {
    const headers = await this.getHeaders();
    const res = await fetch(`${this.baseUrl}/api/v1/sync/bootstrap`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Sync bootstrap failed with HTTP ${res.status}: ${errorText}`);
    }

    return (await res.json()) as SyncBootstrapResponse;
  }
}
