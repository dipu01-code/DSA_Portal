import { createStore } from 'zustand/vanilla';
import {
  ApiError,
  createDsa,
  storageLocalStore,
  webNetworkStatus,
  withProblemCache,
  type DesktopBridge,
  type DsaApi,
  type NetworkStatus,
  type Submission,
} from '@dsa-portal/ui-core';

declare global {
  interface Window {
    dsaDesktop?: DesktopBridge;
  }
}

export const desktop = window.dsaDesktop;

/** Desktop connectivity (from the main process); routes calls to the offline engine. The browser uses navigator.onLine. */
export const connectivity = createStore<{ online: boolean; offlineGuest: boolean }>(() => ({
  online: true,
  offlineGuest: false,
}));

const offlineOnly = (what: string) => {
  throw new ApiError(0, 'OFFLINE', `${what} needs a connection. Practice still works offline.`);
};

/**
 * Desktop: while offline, problem browsing and judging go to the local engine over IPC; everything
 * account-related needs the server. Local submissions are judged at once, so submit + poll still works.
 */
function withOfflineEngine(http: DsaApi, bridge: DesktopBridge): DsaApi {
  const local = new Map<string, Submission>();
  const online = () => connectivity.getState().online;
  const orNotFound = <T>(v: T | null, what: string): T => {
    if (v === null) throw new ApiError(404, 'NOT_FOUND', `${what} not found`);
    return v;
  };
  return {
    ...http,
    login: (b) => (online() ? http.login(b) : offlineOnly('Signing in')),
    register: (b) => (online() ? http.register(b) : offlineOnly('Creating an account')),
    topics: () => (online() ? http.topics() : bridge.offline.topics()),
    randomProblem: async (q) =>
      online()
        ? http.randomProblem(q)
        : orNotFound(await bridge.offline.randomProblem(q ?? {}), 'Problem'),
    problem: async (id) =>
      online() ? http.problem(id) : orNotFound(await bridge.offline.problem(id), 'Problem'),
    hints: (id, upto) => (online() ? http.hints(id, upto) : bridge.offline.hints(id, upto)),
    solution: async (id) => {
      if (online()) return http.solution(id);
      const s = await bridge.offline.solution(id);
      if (s === null) {
        throw new ApiError(
          403,
          'SOLUTION_LOCKED',
          'Solve the problem first to unlock its solution'
        );
      }
      return s;
    },
    async submit(body, key) {
      if (online()) return http.submit(body, key);
      const s = await bridge.offline.submit(body.problemId, body.code);
      local.set(s.id, s);
      // Judged here for instant feedback; the outbox replays it to the server, whose verdict counts.
      dsa.stores.sync
        .getState()
        .enqueue({ ...body, key, local: { passed: s.passed, total: s.total } });
      return { submissionId: s.id, status: s.status };
    },
    submission: (id) => {
      const s = local.get(id);
      return s ? Promise.resolve(s) : http.submission(id);
    },
    stats: () => (online() ? http.stats() : offlineOnly('Stats')),
    streak: () => (online() ? http.streak() : offlineOnly('Stats')),
    topicStats: () => (online() ? http.topicStats() : offlineOnly('Stats')),
    leaderboard: (q) => (online() ? http.leaderboard(q) : offlineOnly('The leaderboard')),
  };
}

const apiBase = desktop?.apiBaseUrl ?? import.meta.env.VITE_API_URL ?? '';

const desktopNetwork: NetworkStatus = {
  isOnline: () => connectivity.getState().online,
  subscribe: (l) => connectivity.subscribe((s, prev) => s.online !== prev.online && l(s.online)),
};

export const dsa = createDsa({
  baseUrl: apiBase,
  settingsStorage: window.localStorage,
  // Socket.IO on the API origin for live results; VITE_REALTIME=0 turns it off (polling only).
  realtimeUrl: import.meta.env.VITE_REALTIME === '0' ? undefined : apiBase,
  network: desktop ? desktopNetwork : webNetworkStatus(),
  // Browser: problems opened before stay readable offline (desktop bundles all problems instead).
  wrapApi: (http) => withProblemCache(http, async () => storageLocalStore(window.localStorage)),
  ...(desktop && {
    refresh: () => desktop.auth.refresh(),
    onTokens: (t) => desktop.auth.saveRefreshToken(t.refreshToken),
    onLogout: () => desktop.auth.logout(),
    wrapApi: (http) => withOfflineEngine(http, desktop),
  }),
});

if (desktop) {
  void desktop.network.isOnline().then((online) => connectivity.setState({ online }));
  desktop.network.onChange((online) => connectivity.setState({ online }));
}
