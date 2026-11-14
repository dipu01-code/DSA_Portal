import { Fragment, useState } from 'react';
import type { RunResult } from '@dsa-portal/ui-core';
import { Icon } from './Icon';
import { prettyJson } from './Examples';

/** One test row; console output and time exist only for "Run" (judged in this browser). */
export type ResultRow = RunResult['results'][number] & { logs?: string[]; timeMs?: number };

export type ResultsView = {
  kind: 'run' | 'submit';
  status: 'pending' | 'done' | 'error';
  message?: string;
  passed?: number;
  total?: number;
  results?: ResultRow[];
};

const MAX_CELL = 32;
// Browsers coarsen timers (≈0.1 ms in workers), so smaller times are noise, not a real 0.
const formatTime = (ms?: number) => (ms === undefined ? '—' : ms < 0.1 ? '<0.1 ms' : `${ms} ms`);
export const truncate = (s: string, max = MAX_CELL) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;
/** Full value for the expanded row: pretty JSON when it parses, else as is. */
const pretty = (s: string | undefined) => (s ? prettyJson(s) : '—');

/**
 * Per-test-case results for both "Run" (visible tests) and "Submit" (graded). `inputs[i]` is test i's
 * input from the problem; click a row (or its button) to see the full input, expected and actual values.
 */
export function ResultsPanel({
  view,
  inputs = [],
}: {
  view: ResultsView | null;
  inputs?: string[];
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  if (!view) {
    return <p className="muted">Run your code (Ctrl/Cmd+Enter) or submit it to see results.</p>;
  }
  if (view.status === 'pending') {
    return <p role="status">{view.kind === 'run' ? 'Running…' : 'Judging…'}</p>;
  }
  if (view.status === 'error') {
    return (
      <p role="alert" className="error">
        {view.message}
      </p>
    );
  }
  const accepted = view.total! > 0 && view.passed === view.total;
  const rows = view.results ?? [];
  const timed = rows.some((r) => r.timeMs !== undefined);
  const cols = timed ? 6 : 5;
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
            <th scope="col">Input</th>
            <th scope="col">Expected</th>
            <th scope="col">Actual</th>
            {timed && <th scope="col">Time</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const i = r.testCaseIndex;
            const expanded = open.has(i);
            const input = inputs[i] ?? '';
            const actual = r.error ? `Error: ${r.error}` : r.actual;
            return (
              <Fragment key={i}>
                <tr className="result-row" onClick={() => toggle(i)}>
                  <td>
                    {/* The button is the keyboard/screen-reader control; the whole row is the mouse target. */}
                    <button
                      type="button"
                      className="row-toggle with-icon"
                      aria-expanded={expanded}
                      aria-controls={`test-${i}-details`}
                      aria-label={`Test ${i + 1} details`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(i);
                      }}
                    >
                      <span className={expanded ? 'chevron open' : 'chevron'}>
                        <Icon name="chevron" size={14} />
                      </span>
                      {i + 1}
                    </button>
                  </td>
                  <td className={r.passed ? 'success' : 'error'}>
                    {r.passed ? '✓ pass' : '✗ fail'}
                  </td>
                  <td>
                    <code>{input ? truncate(input) : '—'}</code>
                  </td>
                  <td>
                    <code>{truncate(r.expected)}</code>
                  </td>
                  <td>
                    <code>{truncate(actual)}</code>
                  </td>
                  {timed && <td>{formatTime(r.timeMs)}</td>}
                </tr>
                {expanded && (
                  <tr className="result-details" id={`test-${i}-details`}>
                    <td colSpan={cols}>
                      <dl>
                        <dt>Input</dt>
                        <dd>
                          <pre>{pretty(input)}</pre>
                        </dd>
                        <dt>Expected</dt>
                        <dd>
                          <pre>{pretty(r.expected)}</pre>
                        </dd>
                        <dt>Actual</dt>
                        <dd>
                          <pre className={r.error ? 'error' : undefined}>
                            {r.error ? `Error: ${r.error}` : pretty(r.actual)}
                          </pre>
                        </dd>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** console.* output per test case, from "Run" in this browser. */
export function ConsolePanel({ view }: { view: ResultsView | null }) {
  if (view?.kind === 'submit') {
    return (
      <p className="muted">
        Console output is shown for Run tests. Submissions are judged on the server, which does not
        return it.
      </p>
    );
  }
  if (!view || view.status !== 'done') {
    return <p className="muted">Run your code to see what it prints with console.log().</p>;
  }
  const withLogs = (view.results ?? []).filter((r) => r.logs?.length);
  if (!withLogs.length) {
    return (
      <p className="muted">No console output. Add console.log(...) to your code and run again.</p>
    );
  }
  return (
    <div className="console">
      {withLogs.map((r) => (
        <section key={r.testCaseIndex} aria-label={`Test ${r.testCaseIndex + 1} output`}>
          <h3>Test {r.testCaseIndex + 1}</h3>
          <pre>{r.logs!.join('\n')}</pre>
        </section>
      ))}
    </div>
  );
}
