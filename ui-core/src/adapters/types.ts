/** Platform adapters: each client passes its own implementation (web below, Electron in /desktop, Expo in /mobile). */

/** Encrypted key-value storage for secrets (Electron safeStorage, expo-secure-store). */
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface NetworkStatus {
  isOnline(): boolean;
  /** Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Local notifications (Expo on Day 7; web/desktop may no-op). */
export interface Notifications {
  schedule(n: { id: string; title: string; body: string; at: Date }): Promise<void>;
  cancel(id: string): Promise<void>;
}

/**
 * Local problem cache for offline reading (expo-sqlite on mobile). The client-side subset of the
 * storage API proposed to Person 2 (Day 5 handover); swap in their store when it exists.
 */
export interface LocalStore {
  saveProblem(problem: import('../api/dsa-api').Problem): Promise<void>;
  getProblem(id: string): Promise<import('../api/dsa-api').Problem | null>;
  listProblems(filter?: {
    topic?: string;
    difficulty?: string;
  }): Promise<import('../api/dsa-api').ProblemSummary[]>;
}
