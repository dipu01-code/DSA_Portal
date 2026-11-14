import type { Difficulty, Problem, Submission } from '../api/dsa-api';

/** Result of "Run": the visible test cases only, not a graded submission. */
export interface RunResult {
  passed: number;
  total: number;
  results: Array<{
    testCaseIndex: number;
    passed: boolean;
    actual: string;
    expected: string;
    error?: string;
  }>;
}

/**
 * What Electron's preload exposes as `window.dsaDesktop` (contextBridge). The renderer never sees
 * Node, the file system or the refresh token: secrets stay in the main process (safeStorage).
 */
export interface DesktopBridge {
  apiBaseUrl: string;
  auth: {
    /** Encrypts and stores the refresh token from the login response. */
    saveRefreshToken(token: string): Promise<void>;
    /** Main process refreshes with the stored token; returns a new access token or null. */
    refresh(): Promise<string | null>;
    /** Revokes the session on the server (if reachable) and wipes the stored token. */
    logout(): Promise<void>;
  };
  network: {
    isOnline(): Promise<boolean>;
    /** Returns an unsubscribe function. */
    onChange(listener: (online: boolean) => void): () => void;
  };
  /** Offline engine: /core + bundled problems in the main process, sandbox in a utility process. */
  offline: {
    topics(): Promise<string[]>;
    randomProblem(q: { topic?: string; difficulty?: Difficulty }): Promise<Problem | null>;
    problem(id: string): Promise<Problem | null>;
    hints(id: string, upto: number): Promise<string[]>;
    /** null while the problem isn't solved locally (same rule as the server). */
    solution(id: string): Promise<string | null>;
    run(problemId: string, code: string): Promise<RunResult>;
    submit(problemId: string, code: string): Promise<Submission>;
  };
  /** Native menu / shortcut actions. */
  onMenu(listener: (action: 'run' | 'submit' | 'switch-topic') => void): () => void;
}
