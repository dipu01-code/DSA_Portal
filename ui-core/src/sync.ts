import { createStore, type StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { ApiError } from './api/client';
import { errorMessage as message } from './stores';
import type { DsaApi, Submission } from './api/dsa-api';
import type { NetworkStatus } from './adapters/types';

/**
 * Offline outbox for submissions: what the user submits without a connection is kept on the
 * device and replayed through POST /submissions (same Idempotency-Key) when the network returns.
 * The server judges it again and its verdict is the one that counts.
 * shortcut: client-side stand-in for Person 2's SyncEngine (CR-030); swap the replay for /sync/push when it exists.
 */
export interface QueuedSubmission {
  /** Idempotency-Key: a replay after a lost response can't create a second submission. */
  key: string;
  problemId: string;
  code: string;
  /** Owner when queued; null for a desktop offline guest (synced to whoever signs in). */
  userId: string | null;
  queuedAt: string;
  state: 'pending' | 'syncing' | 'synced' | 'conflict' | 'rejected';
  /** Desktop judges offline: the local verdict, compared with the server's. */
  local?: { passed: number; total: number };
  server?: { submissionId: string; status: Submission['status']; passed?: number; total?: number };
  message?: string;
}

export interface SyncState {
  online: boolean;
  status: 'online' | 'offline' | 'syncing' | 'error';
  queue: QueuedSubmission[];
  lastError: string | null;
  lastSyncedAt: string | null;
  enqueue(
    item: Pick<QueuedSubmission, 'problemId' | 'code'> &
      Partial<Pick<QueuedSubmission, 'key' | 'local'>>
  ): QueuedSubmission;
  syncNow(): Promise<void>;
  /** Removes finished items (synced, conflict, rejected). */
  clearFinished(): void;
}

export const pendingCount = (s: Pick<SyncState, 'queue'>) =>
  s.queue.filter((q) => q.state === 'pending' || q.state === 'syncing').length;

export interface SyncOptions {
  network?: NetworkStatus;
  storage?: StateStorage;
  /** Current signed-in user id, or null: nothing is replayed without a session. */
  currentUser(): string | null;
  onSynced?(): void;
  pollMs?: number;
  timeoutMs?: number;
  sleep?(ms: number): Promise<void>;
}

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createSyncStore(api: DsaApi, o: SyncOptions): StoreApi<SyncState> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 750;
  const timeoutMs = o.timeoutMs ?? 60_000;
  let running: Promise<void> | null = null;

  const init = (
    set: StoreApi<SyncState>['setState'],
    get: StoreApi<SyncState>['getState']
  ): SyncState => {
    const patch = (key: string, p: Partial<QueuedSubmission>) =>
      set((s) => ({ queue: s.queue.map((q) => (q.key === key ? { ...q, ...p } : q)) }));

    /** Submit + poll one item; throws ApiError on network/auth problems so the loop can stop. */
    async function replay(q: QueuedSubmission) {
      patch(q.key, { state: 'syncing', message: undefined });
      let submissionId: string;
      try {
        ({ submissionId } = await api.submit({ problemId: q.problemId, code: q.code }, q.key));
      } catch (e) {
        // 4xx other than auth/rate limit: the server will never take it (problem removed, bad body).
        if (
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 401 &&
          e.status !== 429
        ) {
          return patch(q.key, {
            state: 'rejected',
            message: `The server refused this submission: ${e.message}`,
          });
        }
        throw e;
      }
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const s = await api.submission(submissionId);
        const server = { submissionId, status: s.status, passed: s.passed, total: s.total };
        if (s.status === 'judged' || s.status === 'failed') {
          const differs = q.local && s.status === 'judged' && s.passed !== q.local.passed;
          return patch(q.key, {
            server,
            state: differs ? 'conflict' : 'synced',
            message: differs
              ? `Offline run passed ${q.local!.passed}/${q.local!.total}, the server judged ${s.passed}/${s.total}. The server's result counts.`
              : s.status === 'failed'
                ? 'The judge failed to run this submission.'
                : undefined,
          });
        }
        if (Date.now() > deadline) {
          return patch(q.key, {
            server,
            state: 'pending',
            message: 'Still waiting for the judge; will check again.',
          });
        }
        await sleep(pollMs);
      }
    }

    async function loop() {
      const user = o.currentUser();
      if (!get().online) return set({ status: 'offline' });
      if (!user) {
        return set({
          status: pendingCount(get()) ? 'error' : 'online',
          lastError: pendingCount(get()) ? 'Sign in to sync your offline submissions.' : null,
        });
      }
      set({ status: 'syncing', lastError: null });
      let synced = 0;
      // Oldest first; 'syncing' left over from a closed app is retried (the key makes it safe).
      for (const q of get().queue.filter(
        (x) =>
          (x.state === 'pending' || x.state === 'syncing') &&
          (x.userId === null || x.userId === user)
      )) {
        try {
          await replay(q);
          synced++;
        } catch (e) {
          patch(q.key, { state: 'pending' });
          const offline = e instanceof ApiError && e.status === 0;
          // 401 here means the refresh failed too: the session ended while the device was offline.
          const lastError = offline
            ? null
            : e instanceof ApiError && e.status === 401
              ? 'Your session ended. Sign in to sync your offline submissions.'
              : message(e);
          return set({ status: offline || !get().online ? 'offline' : 'error', lastError });
        }
      }
      set({ status: 'online', lastSyncedAt: new Date().toISOString() });
      if (synced) o.onSynced?.();
    }

    return {
      online: o.network?.isOnline() ?? true,
      status: (o.network?.isOnline() ?? true) ? 'online' : 'offline',
      queue: [],
      lastError: null,
      lastSyncedAt: null,
      enqueue(item) {
        const q: QueuedSubmission = {
          key: item.key ?? uuid(),
          problemId: item.problemId,
          code: item.code,
          local: item.local,
          userId: o.currentUser(),
          queuedAt: new Date().toISOString(),
          state: 'pending',
        };
        set((s) => ({ queue: [...s.queue, q] }));
        return q;
      },
      syncNow: () => (running ??= loop().finally(() => (running = null))),
      clearFinished: () =>
        set((s) => ({
          queue: s.queue.filter((q) => q.state === 'pending' || q.state === 'syncing'),
        })),
    };
  };

  const store = o.storage
    ? createStore<SyncState>()(
        persist((set, get) => init(set, get), {
          name: 'dsa.outbox',
          storage: createJSONStorage(() => o.storage!),
          partialize: (s) => ({ queue: s.queue }) as SyncState,
        })
      )
    : createStore<SyncState>()((set, get) => init(set, get));

  o.network?.subscribe((online) => {
    store.setState({ online, status: online ? 'online' : 'offline' });
    if (online) void store.getState().syncNow(); // reconnect → replay
  });
  return store;
}

/** One-line status for the indicators, same words on every client. */
export function syncSummary(s: Pick<SyncState, 'status' | 'queue'>): string {
  const n = pendingCount(s);
  const queued = n ? ` · ${n} queued` : '';
  if (s.status === 'syncing') return `Syncing ${n}…`;
  if (s.status === 'offline') return `Offline${queued}`;
  if (s.status === 'error') return `Sync problem${queued}`;
  return `Online${queued}`;
}

/** What one queued submission is doing, e.g. "Synced · Accepted 2/2". */
export function describeQueued(q: QueuedSubmission): string {
  const verdict =
    q.server?.status === 'judged'
      ? ` · ${q.server.passed === q.server.total ? 'Accepted' : 'Wrong answer'} ${q.server.passed}/${q.server.total}`
      : '';
  const label = {
    pending: 'Waiting to sync',
    syncing: 'Sending and judging…',
    synced: 'Synced',
    conflict: 'Conflict',
    rejected: 'Not accepted',
  }[q.state];
  return `${label}${q.state === 'synced' || q.state === 'conflict' ? verdict : ''}`;
}
