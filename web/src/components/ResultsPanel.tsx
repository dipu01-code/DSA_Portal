import type { RunResult } from '@dsa-portal/ui-core';

export type ResultsView = {
  kind: 'run' | 'submit';
  status: 'pending' | 'done' | 'error';
  message?: string;
} & Partial<RunResult>;

/** Per-test-case output for both "Run" (visible tests) and "Submit" (graded). */
export function ResultsPanel({ view }: { view: ResultsView | null }) {
  if (!view)
    return <p className="muted">Run your code (Ctrl/Cmd+Enter) or submit it to see results.</p>;
  if (view.status === 'pending')
    return <p role="status">{view.kind === 'run' ? 'Running…' : 'Judging…'}</p>;
  if (view.status === 'error')
    return (
      <p role="alert" className="error">
        {view.message}
      </p>
    );
  const accepted = view.total! > 0 && view.passed === view.total;
  return (
    <section aria-live="polite">
      <p className={accepted ? 'success' : 'error'}>
        <strong>
          {view.kind === 'submit'
            ? accepted
              ? 'Accepted'
              : 'Wrong answer'
            : accepted
              ? 'All visible tests pass'
              : 'Some tests fail'}
        </strong>{' '}
        · {view.passed}/{view.total} passed
      </p>
      <table className="results">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Result</th>
            <th scope="col">Expected</th>
            <th scope="col">Actual</th>
          </tr>
        </thead>
        <tbody>
          {view.results?.map((r) => (
            <tr key={r.testCaseIndex}>
              <td>{r.testCaseIndex + 1}</td>
              <td className={r.passed ? 'success' : 'error'}>{r.passed ? '✓ pass' : '✗ fail'}</td>
              <td>
                <code>{r.expected}</code>
              </td>
              <td>
                <code>{r.error ? `Error: ${r.error}` : r.actual}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
