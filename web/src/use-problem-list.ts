import { useEffect, useState } from 'react';
import { useDsa, type DsaApi, type ProblemSummary } from '@dsa-portal/ui-core';

// One fetch per session (per API instance): Previous/Next shouldn't refetch the catalogue on every problem.
const cache = new WeakMap<DsaApi, Promise<ProblemSummary[]>>();

async function fetchAll(api: DsaApi): Promise<ProblemSummary[]> {
  const all: ProblemSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.problems({ cursor, limit: 100 });
    all.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** The catalogue in the API's order (by id), for Previous / Next. null until loaded or if it can't load. */
export function useProblemList(): ProblemSummary[] | null {
  const { api } = useDsa();
  const [list, setList] = useState<ProblemSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!cache.has(api)) cache.set(api, fetchAll(api));
    cache.get(api)!.then(
      (l) => !cancelled && setList(l),
      () => {
        cache.delete(api); // offline or failed: try again next time
        if (!cancelled) setList(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [api]);
  return list;
}
