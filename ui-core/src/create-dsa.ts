import { createApiClient, type ApiClientConfig } from './api/client';
import { createHttpApi, type DsaApi } from './api/dsa-api';
import { browserRefresh } from './auth/refresh';
import {
  createAuthStore,
  createProblemStore,
  createSettingsStore,
  createStatsStore,
  createSubmissionStore,
  type AuthHooks,
} from './stores';
import type { StateStorage } from 'zustand/middleware';
import { createRealtime, type Realtime } from './realtime';
import { createSyncStore } from './sync';
import type { NetworkStatus } from './adapters/types';

export interface DsaConfig extends AuthHooks {
  baseUrl: string;
  refresh?: ApiClientConfig['refresh'];
  fetch?: typeof fetch;
  retry?: ApiClientConfig['retry'];
  /** Persists settings and the offline submission outbox: localStorage on web, SQLite kv on mobile. */
  settingsStorage?: StateStorage;
  /** Drives the sync status and replays the outbox on reconnect. */
  network?: NetworkStatus;
  pollMs?: number;
  /** Desktop wraps the HTTP API to answer from its offline engine when there is no network. */
  wrapApi?: (http: DsaApi) => DsaApi;
  /** Socket.IO origin for live results ('' = same origin); omit to only poll. */
  realtimeUrl?: string;
  /** For tests: a Realtime instead of a real socket. */
  realtime?: Realtime;
}

/** With a live socket the poll is a slow safety net (5 s) that a pushed result cuts short. */
const SOCKET_SAFETY_POLL_MS = 5000;

/** One call per app: API client + typed API + all stores, wired together. */
export function createDsa(cfg: DsaConfig) {
  let onAuthLost = () => {};
  const client = createApiClient({
    baseUrl: cfg.baseUrl,
    refresh: cfg.refresh ?? browserRefresh(cfg.baseUrl, cfg.fetch),
    fetch: cfg.fetch,
    retry: cfg.retry,
    onAuthLost: () => onAuthLost(),
  });
  const http = createHttpApi(client);
  const api = cfg.wrapApi ? cfg.wrapApi(http) : http;
  const stats = createStatsStore(api);
  const realtime =
    cfg.realtime ??
    (cfg.realtimeUrl !== undefined ? createRealtime(cfg.realtimeUrl, client.getAccessToken) : null);
  const pollMs = cfg.pollMs ?? 750;
  const waitBetweenPolls = (t: { submissionId: string; problemId: string }) =>
    realtime?.connected()
      ? realtime.waitForResult(t, SOCKET_SAFETY_POLL_MS)
      : new Promise((r) => setTimeout(r, pollMs));
  const auth = createAuthStore(api, client, cfg);
  const sync = createSyncStore(api, {
    network: cfg.network,
    storage: cfg.settingsStorage,
    pollMs,
    currentUser: () => auth.getState().user?.id ?? null,
    onSynced: () => void stats.getState().load(),
  });
  const stores = {
    auth,
    problem: createProblemStore(api),
    submission: createSubmissionStore(api, {
      pollMs,
      waitBetweenPolls,
      onJudged: () => void stats.getState().load(),
      onOffline: (s) => sync.getState().enqueue(s),
    }),
    stats,
    settings: createSettingsStore(cfg.settingsStorage),
    sync,
  };
  onAuthLost = () => stores.auth.getState().sessionLost();
  // Signing in (or restoring the session) replays anything queued while offline.
  auth.subscribe((s, prev) => {
    if (s.user && s.user !== prev.user) void sync.getState().syncNow();
    // Signing out (or losing the session) clears the last user's data from memory: a shared
    // computer must not show their stats, open problem or result to the next person.
    if (prev.user && !s.user) {
      stores.submission.getState().reset();
      stores.problem.setState({ problem: null, code: '', hints: [], solution: null, error: null });
      stats.setState({ summary: null, streak: null, error: null });
    }
  });
  return { client, api, stores, realtime };
}

export type Dsa = ReturnType<typeof createDsa>;
