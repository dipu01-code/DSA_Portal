import { compareHlc } from './hlc';

export interface SettingsConflictResult<T = Record<string, unknown>> {
  winner: 'local' | 'remote';
  winningHlc: string;
  value: T;
}

export interface DerivedProblemStats {
  attempts: number;
  solved: boolean;
  firstSolvedAt?: string | null;
  lastAttemptedAt: string;
}

/**
 * Deterministic conflict resolver implementing domain sync rules.
 */
export class ConflictResolver {
  /**
   * Resolves conflicts for user settings using Last-Write-Wins (LWW) via HLC.
   */
  static resolveSettings<T extends Record<string, unknown>>(
    localValue: T,
    localHlc: string,
    remoteValue: T,
    remoteHlc: string
  ): SettingsConflictResult<T> {
    const cmp = compareHlc(remoteHlc, localHlc);
    if (cmp > 0) {
      return { winner: 'remote', winningHlc: remoteHlc, value: remoteValue };
    }
    return { winner: 'local', winningHlc: localHlc, value: localValue };
  }

  /**
   * Submissions are append-only; both local and remote submissions are retained.
   */
  static resolveSubmission(): 'keep_both' {
    return 'keep_both';
  }

  /**
   * Recomputes problem stats deterministically from an array of submissions.
   */
  static recomputeStats(
    submissions: Array<{ passed: number; total: number; createdAt: string | Date }>
  ): DerivedProblemStats {
    if (submissions.length === 0) {
      return {
        attempts: 0,
        solved: false,
        firstSolvedAt: null,
        lastAttemptedAt: new Date(0).toISOString(),
      };
    }

    const sorted = [...submissions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const attempts = sorted.length;
    const solvedSub = sorted.find((s) => s.passed === s.total && s.total > 0);
    const solved = Boolean(solvedSub);
    const firstSolvedAt = solvedSub ? new Date(solvedSub.createdAt).toISOString() : null;
    const lastAttemptedAt = new Date(sorted[sorted.length - 1].createdAt).toISOString();

    return {
      attempts,
      solved,
      firstSolvedAt,
      lastAttemptedAt,
    };
  }
}
