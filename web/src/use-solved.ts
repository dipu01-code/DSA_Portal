import { useEffect, useState } from 'react';
import { useDsa, type Submission } from '@dsa-portal/ui-core';

export const isAccepted = (s: Pick<Submission, 'status' | 'passed' | 'total'>) =>
  s.status === 'judged' && s.total > 0 && s.passed === s.total;

/**
 * Has the signed-in user solved this problem? From their own submissions (GET /submissions?problemId),
 * since the problem itself carries no per-user flag. null while unknown (loading, offline, signed out).
 */
export function useSolved(problemId: string | undefined, refreshKey?: unknown): boolean | null {
  const { api } = useDsa();
  const [solved, setSolved] = useState<boolean | null>(null);
  useEffect(() => {
    if (!problemId) return;
    let cancelled = false;
    setSolved(null);
    (async () => {
      let cursor: string | undefined;
      // shortcut: pages through every submission for one problem; fine for one user, add a solved flag to the API if this grows.
      do {
        const page = await api.submissions({ problemId, cursor, limit: 100 });
        if (page.data.some(isAccepted)) return true;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return false;
    })().then(
      (v) => !cancelled && setSolved(v),
      () => !cancelled && setSolved(null)
    );
    return () => {
      cancelled = true;
    };
  }, [api, problemId, refreshKey]);
  return solved;
}
