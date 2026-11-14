import { io, type Socket } from 'socket.io-client';

/** `submission:queued|running|finished` payload (docs/websocket-events.md); per-test results come over REST. */
export interface SubmissionEvent {
  submissionId: string;
  problemId: string;
  status: 'queued' | 'running' | 'judged' | 'failed';
  passed: number;
  total: number;
}

export interface Realtime {
  connected(): boolean;
  /** Listen for connect/disconnect; returns unsubscribe. */
  onStatus(listener: (connected: boolean) => void): () => void;
  /** Resolves true when the server announces `submission:finished` for it (false after timeoutMs). */
  waitForResult(
    target: { submissionId: string; problemId: string },
    timeoutMs: number
  ): Promise<boolean>;
  /** `leaderboard:updated`, debounced (it fires on every accepted submission). */
  onLeaderboardUpdate(listener: () => void): () => void;
  /** `daily:new`: a new UTC day's challenge exists. */
  onDailyNew(listener: () => void): () => void;
  close(): void;
}

const UNAUTHORIZED_RETRY_MS = 10_000;

/**
 * Socket.IO client for Person 1's gateway. The access token goes in the handshake (`auth` is a
 * function, so every reconnect sends the current token). Never required: while the socket is
 * down, callers keep polling.
 */
export function createRealtime(
  url: string,
  getToken: () => string | null,
  connect: typeof io = io,
  debounceMs = 1000
): Realtime {
  const socket: Socket = connect(url, {
    transports: ['websocket'],
    reconnectionDelayMax: 30_000,
    auth: (cb) => cb({ token: getToken() }),
  });
  const statusListeners = new Set<(c: boolean) => void>();
  const waiters = new Set<{ id: string; done(ok: boolean): void }>();

  const status = (c: boolean) => statusListeners.forEach((l) => l(c));
  socket.on('connect', () => status(true));
  socket.on('disconnect', () => status(false));
  // A rejected handshake (no or expired token) isn't retried by Socket.IO itself; try again later,
  // by when the API client has refreshed the token (or the user has signed in).
  let retry: ReturnType<typeof setTimeout> | undefined;
  socket.on('connect_error', (err) => {
    if (err.message !== 'UNAUTHORIZED') return;
    clearTimeout(retry);
    retry = setTimeout(() => socket.connect(), UNAUTHORIZED_RETRY_MS);
  });
  socket.on('submission:finished', (e: SubmissionEvent) => {
    for (const w of [...waiters]) if (w.id === e.submissionId) w.done(true);
  });

  return {
    connected: () => socket.connected,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => void statusListeners.delete(listener);
    },
    waitForResult({ submissionId }, timeoutMs) {
      return new Promise<boolean>((resolve) => {
        const w = {
          id: submissionId,
          done: (ok: boolean) => {
            clearTimeout(timer);
            waiters.delete(w);
            resolve(ok);
          },
        };
        const timer = setTimeout(() => w.done(false), timeoutMs);
        waiters.add(w);
      });
    },
    onLeaderboardUpdate(listener) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const handler = () => {
        clearTimeout(t);
        t = setTimeout(listener, debounceMs);
      };
      socket.on('leaderboard:updated', handler);
      return () => {
        clearTimeout(t);
        socket.off('leaderboard:updated', handler);
      };
    },
    onDailyNew(listener) {
      socket.on('daily:new', listener);
      return () => void socket.off('daily:new', listener);
    },
    close: () => {
      clearTimeout(retry);
      socket.close();
    },
  };
}
