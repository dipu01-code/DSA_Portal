import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';
import type { Dsa } from '../create-dsa';
import type { DailyChallenge, LeaderboardEntry } from '../api/dsa-api';
import { errorMessage } from '../stores';

const DsaContext = createContext<Dsa | null>(null);

export function DsaProvider({ value, children }: { value: Dsa; children: ReactNode }) {
  return <DsaContext.Provider value={value}>{children}</DsaContext.Provider>;
}

export function useDsa(): Dsa {
  const dsa = useContext(DsaContext);
  if (!dsa) throw new Error('useDsa must be used inside <DsaProvider>');
  return dsa;
}

export const useAuth = () => useStore(useDsa().stores.auth);
export const useProblem = () => useStore(useDsa().stores.problem);
export const useSubmission = () => useStore(useDsa().stores.submission);

/** Submission state plus `live`: true while results arrive by socket, false while the hook falls back to polling. */
export function useSubmissionStatus() {
  const { realtime } = useDsa();
  const live = useSyncExternalStore(
    (cb) => realtime?.onStatus(cb) ?? (() => {}),
    () => realtime?.connected() ?? false
  );
  return { ...useSubmission(), live };
}

/** Today's challenge; `error` is set (e.g. offline or none today) rather than thrown. */
export function useDailyChallenge() {
  const { api, realtime } = useDsa();
  const [day, setDay] = useState(0); // bumped by the server's daily:new just after UTC midnight
  useEffect(() => realtime?.onDailyNew(() => setDay((d) => d + 1)), [realtime]);
  const [state, setState] = useState<{
    daily: DailyChallenge | null;
    loading: boolean;
    error: string | null;
  }>({ daily: null, loading: true, error: null });
  const online = useStore(useDsa().stores.sync, (s) => s.online);
  useEffect(() => {
    let live = true;
    api.dailyChallenge().then(
      (daily) => live && setState({ daily, loading: false, error: null }),
      (e: unknown) => live && setState({ daily: null, loading: false, error: errorMessage(e) })
    );
    return () => {
      live = false;
    };
  }, [api, online, day]); // hidden while offline, back after a reconnect
  return state;
}
export const useSettings = () => useStore(useDsa().stores.settings);
/**
 * Outbox + connectivity: status, queue, syncNow(). The queue shows only the signed-in user's
 * items (and offline-guest ones): another person's queued code stays hidden on a shared device.
 */
export function useSync() {
  const { stores } = useDsa();
  const state = useStore(stores.sync);
  const userId = useStore(stores.auth, (a) => a.user?.id ?? null);
  return { ...state, queue: state.queue.filter((q) => q.userId === null || q.userId === userId) };
}

/** Loads stats on mount (and when `reloadKey` changes, e.g. after a judged submission). */
export function useStats(reloadKey?: unknown) {
  const store = useDsa().stores.stats;
  const state = useStore(store);
  useEffect(() => {
    void store.getState().load();
  }, [store, reloadKey]);
  return state;
}

/** Leaderboard pages; reloads from the top when the server pushes `leaderboard:update`. */
export function useLeaderboard(limit = 20) {
  const { api, realtime } = useDsa();
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{
    entries: LeaderboardEntry[];
    nextCursor: string | null;
    loading: boolean;
    error: string | null;
  }>({
    entries: [],
    nextCursor: null,
    loading: true,
    error: null,
  });
  useEffect(() => realtime?.onLeaderboardUpdate(() => setTick((t) => t + 1)), [realtime]);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    api
      .leaderboard({ limit })
      .then(
        (p) =>
          live &&
          setState({ entries: p.data, nextCursor: p.nextCursor, loading: false, error: null })
      )
      .catch(
        (e: unknown) =>
          live &&
          setState({ entries: [], nextCursor: null, loading: false, error: errorMessage(e) })
      );
    return () => {
      live = false;
    };
  }, [api, limit, tick]);
  const loadMore = async () => {
    if (!state.nextCursor || state.loading) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const p = await api.leaderboard({ limit, cursor: state.nextCursor });
      setState((s) => ({
        entries: [...s.entries, ...p.data],
        nextCursor: p.nextCursor,
        loading: false,
        error: null,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  };
  return { ...state, reload: () => setTick((t) => t + 1), loadMore };
}
