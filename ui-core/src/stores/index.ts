import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { ApiError, type ApiClient } from '../api/client';
import type {
  DsaApi,
  Difficulty,
  Problem,
  StatsMe,
  StreakDetail,
  Submission,
  TokenPair,
  User,
} from '../api/dsa-api';

/** User-facing error text; a network failure gets a plain sentence instead of "Failed to fetch". */
export const errorMessage = (e: unknown) =>
  e instanceof ApiError && e.status === 0
    ? 'No connection to the server. Check your network and try again.'
    : e instanceof ApiError && e.code === 'QUOTA_EXCEEDED' // CR-023: per-user submission quota
      ? "You've hit the submission limit. Wait a minute and try again."
      : e instanceof Error
        ? e.message
        : String(e);
const message = errorMessage;

// ---------------------------------------------------------------- auth
export interface AuthState {
  status: 'unknown' | 'anonymous' | 'authenticated';
  user: User | null;
  busy: boolean;
  error: string | null;
  /** On app start: use the refresh token (cookie or secure storage) to get back in without a password. */
  restore(): Promise<void>;
  login(email: string, password: string): Promise<boolean>;
  register(username: string, email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  /** The API client calls this when a refresh fails. */
  sessionLost(): void;
}

export interface AuthHooks {
  /** Native platforms keep `refreshToken` in SecureStorage (the browser has the cookie). */
  onTokens?: (t: TokenPair) => Promise<void>;
  /** Native platforms revoke the session with their stored token and wipe it. */
  onLogout?: () => Promise<void>;
}

export function createAuthStore(
  api: DsaApi,
  client: ApiClient,
  hooks: AuthHooks = {}
): StoreApi<AuthState> {
  return createStore<AuthState>((set, get) => {
    const run = async (fn: () => Promise<void>) => {
      set({ busy: true, error: null });
      try {
        await fn();
        return true;
      } catch (e) {
        set({ error: message(e) });
        return false;
      } finally {
        set({ busy: false });
      }
    };
    return {
      status: 'unknown',
      user: null,
      busy: false,
      error: null,
      async restore() {
        const token = await client.refresh();
        if (!token) return set({ status: 'anonymous', user: null });
        try {
          set({ status: 'authenticated', user: await api.me() });
        } catch {
          set({ status: 'anonymous', user: null });
        }
      },
      login: (email, password) =>
        run(async () => {
          const tokens = await api.login({ email, password });
          await hooks.onTokens?.(tokens);
          set({ status: 'authenticated', user: await api.me() });
        }),
      register: (username, email, password) =>
        run(async () => {
          await api.register({ username, email, password });
          if (!(await get().login(email, password))) throw new Error(get().error ?? 'Login failed');
        }),
      async logout() {
        await Promise.allSettled([hooks.onLogout ? hooks.onLogout() : api.logout()]);
        client.setAccessToken(null);
        set({ status: 'anonymous', user: null, error: null });
      },
      sessionLost: () => set({ status: 'anonymous', user: null }),
    };
  });
}

// ---------------------------------------------------------------- problem session
export interface ProblemState {
  topic: string | null;
  difficulty: Difficulty | null;
  problem: Problem | null;
  code: string;
  hints: string[];
  solution: string | null;
  loading: boolean;
  error: string | null;
  setFilters(topic: string | null, difficulty: Difficulty | null): void;
  loadRandom(): Promise<void>;
  load(id: string): Promise<void>;
  setCode(code: string): void;
  /** Progressive hints: asks the API for one more than shown. */
  nextHint(): Promise<void>;
  revealSolution(): Promise<void>;
}

export function createProblemStore(api: DsaApi): StoreApi<ProblemState> {
  return createStore<ProblemState>((set, get) => {
    const open = async (fetchProblem: () => Promise<Problem>) => {
      set({ loading: true, error: null });
      try {
        const problem = await fetchProblem();
        set({ problem, code: problem.starterCode, hints: [], solution: null });
      } catch (e) {
        set({
          error:
            e instanceof ApiError && e.status === 404
              ? 'No problem matches these filters'
              : message(e),
        });
      } finally {
        set({ loading: false });
      }
    };
    return {
      topic: null,
      difficulty: null,
      problem: null,
      code: '',
      hints: [],
      solution: null,
      loading: false,
      error: null,
      setFilters: (topic, difficulty) => set({ topic, difficulty }),
      loadRandom: () =>
        open(() =>
          api.randomProblem({
            topic: get().topic ?? undefined,
            difficulty: get().difficulty ?? undefined,
          })
        ),
      load: (id) => open(() => api.problem(id)),
      setCode: (code) => set({ code }),
      async nextHint() {
        const { problem, hints } = get();
        if (!problem) return;
        try {
          set({ hints: await api.hints(problem.id, hints.length + 1), error: null });
        } catch (e) {
          set({ error: message(e) });
        }
      },
      async revealSolution() {
        const { problem } = get();
        if (!problem) return;
        try {
          set({ solution: await api.solution(problem.id), error: null });
        } catch (e) {
          set({
            error:
              e instanceof ApiError && e.code === 'SOLUTION_LOCKED'
                ? 'Solve the problem first to unlock its solution'
                : message(e),
          });
        }
      },
    };
  });
}

// ---------------------------------------------------------------- submission
export interface SubmissionState {
  /** 'queued': no connection, the submission waits in the sync outbox. */
  status: 'idle' | 'submitting' | 'judging' | 'done' | 'error' | 'queued';
  current: Submission | null;
  error: string | null;
  /** Outbox key of the submission queued offline, so the page can follow it until it syncs. */
  queuedKey: string | null;
  submit(problemId: string, code: string): Promise<void>;
  reset(): void;
}

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Polls GET /submissions/:id until judged/failed. `waitBetweenPolls` lets a socket push wake the
 * poll early (createDsa wires Socket.IO); without it, or while the socket is down, it is plain polling.
 */
export function createSubmissionStore(
  api: DsaApi,
  opts: {
    pollMs?: number;
    timeoutMs?: number;
    onJudged?: (s: Submission) => void;
    sleep?: (ms: number) => Promise<void>;
    waitBetweenPolls?: (target: { submissionId: string; problemId: string }) => Promise<unknown>;
    /** Called instead of failing when the network is down (createDsa passes the sync outbox). */
    onOffline?: (s: { problemId: string; code: string; key: string }) => void;
  } = {}
): StoreApi<SubmissionState> {
  const pollMs = opts.pollMs ?? 750;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const wait = opts.waitBetweenPolls ?? (() => sleep(pollMs));
  let run = 0; // a newer submit or reset cancels an older poll loop
  return createStore<SubmissionState>((set) => ({
    status: 'idle',
    current: null,
    error: null,
    queuedKey: null,
    reset() {
      run++;
      set({ status: 'idle', current: null, error: null, queuedKey: null });
    },
    async submit(problemId, code) {
      const mine = ++run;
      set({ status: 'submitting', current: null, error: null, queuedKey: null });
      // One key per click: a retry after a timeout (or an outbox replay) can't create a second submission.
      const key = uuid();
      try {
        const { submissionId } = await api.submit({ problemId, code }, key);
        set({ status: 'judging' });
        const deadline = Date.now() + timeoutMs;
        while (mine === run) {
          const s = await api.submission(submissionId);
          if (mine !== run) return;
          set({ current: s });
          if (s.status === 'judged' || s.status === 'failed') {
            set({ status: 'done' });
            opts.onJudged?.(s);
            return;
          }
          if (Date.now() > deadline) {
            throw new Error('Judging is taking too long; check back in a moment');
          }
          await wait({ submissionId, problemId });
        }
      } catch (e) {
        if (mine !== run) return;
        if (e instanceof ApiError && e.status === 0 && opts.onOffline) {
          opts.onOffline({ problemId, code, key });
          return set({ status: 'queued', queuedKey: key });
        }
        set({ status: 'error', error: message(e) });
      }
    },
  }));
}

// ---------------------------------------------------------------- stats
export interface StatsState {
  summary: StatsMe | null;
  streak: StreakDetail | null;
  loading: boolean;
  error: string | null;
  load(): Promise<void>;
}

export function createStatsStore(api: DsaApi): StoreApi<StatsState> {
  return createStore<StatsState>((set) => ({
    summary: null,
    streak: null,
    loading: false,
    error: null,
    async load() {
      set({ loading: true, error: null });
      try {
        const [summary, streak] = await Promise.all([api.stats(), api.streak()]);
        set({ summary, streak });
      } catch (e) {
        set({ error: message(e) });
      } finally {
        set({ loading: false });
      }
    },
  }));
}

// ---------------------------------------------------------------- settings
export interface SettingsState {
  theme: 'system' | 'light' | 'dark';
  editorFontSize: number;
  setTheme(t: SettingsState['theme']): void;
  setEditorFontSize(px: number): void;
}

/** Persisted (non-secret) preferences; pass localStorage on web, AsyncStorage on mobile. */
export function createSettingsStore(storage?: StateStorage): StoreApi<SettingsState> {
  const init = (set: StoreApi<SettingsState>['setState']): SettingsState => ({
    theme: 'system',
    editorFontSize: 14,
    setTheme: (theme) => set({ theme }),
    setEditorFontSize: (px) => set({ editorFontSize: Math.min(28, Math.max(10, Math.round(px))) }),
  });
  if (!storage) return createStore<SettingsState>()((set) => init(set));
  return createStore<SettingsState>()(
    persist((set) => init(set), { name: 'dsa.settings', storage: createJSONStorage(() => storage) })
  );
}
