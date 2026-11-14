import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from 'zustand';
import {
  describeQueued,
  useProblem,
  useSettings,
  useSubmissionStatus,
  useSync,
} from '@dsa-portal/ui-core';
import { themeMode } from '../theme';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ResultsPanel, type ResultsView } from '../components/ResultsPanel';
import { desktop } from '../platform';
import { runInWorker } from '../run-in-worker';

// Monaco is ~3 MB: load it only on this page.
const CodeEditor = lazy(() =>
  import('../components/CodeEditor').then((m) => ({ default: m.CodeEditor }))
);

export function ProblemPage() {
  const { id = '' } = useParams();
  const p = useProblem();
  const sub = useSubmissionStatus();
  const { editorFontSize } = useSettings();
  const [run, setRun] = useState<ResultsView | null>(null);
  const [showResults, setShowResults] = useState<'run' | 'submit' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dark = useStore(themeMode).mode === 'dark';
  const { queue } = useSync();
  const queued = sub.queuedKey ? queue.find((q) => q.key === sub.queuedKey) : undefined;

  useEffect(() => {
    if (p.problem?.id !== id) void p.load(id);
    sub.reset();
    setRun(null);
    setShowResults(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const latest = useRef({ p, sub });
  latest.current = { p, sub };

  const doRun = useCallback(async () => {
    const { problem, code } = latest.current.p;
    if (!problem) return;
    setShowResults('run');
    setRun({ kind: 'run', status: 'pending' });
    try {
      const r = desktop
        ? await desktop.offline.run(problem.id, code)
        : await runInWorker(problem, code);
      setRun({ kind: 'run', status: 'done', ...r });
    } catch (e) {
      setRun({ kind: 'run', status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const doSubmit = useCallback(() => {
    const { problem, code } = latest.current.p;
    if (!problem) return;
    setShowResults('submit');
    void latest.current.sub.submit(problem.id, code);
  }, []);

  useEffect(
    () =>
      desktop?.onMenu((a) =>
        a === 'run' ? void doRun() : a === 'submit' ? doSubmit() : undefined
      ),
    [doRun, doSubmit]
  );
  // Ctrl/Cmd+Enter outside the editor too (inside it Monaco handles the key itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void doRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doRun]);

  if (p.loading || (!p.problem && !p.error)) {
    return (
      <div className="problem-layout" aria-busy="true">
        <span className="sr-only" role="status">
          Loading problem…
        </span>
        <div className="card skeleton" />
        <div className="card skeleton" />
      </div>
    );
  }
  if (!p.problem)
    return (
      <p role="alert" className="error">
        {p.error}
      </p>
    );
  const problem = p.problem;

  const submitView: ResultsView | null =
    sub.status === 'idle'
      ? null
      : sub.status === 'error'
        ? { kind: 'submit', status: 'error', message: sub.error ?? 'Submission failed' }
        : sub.status !== 'done' || !sub.current
          ? { kind: 'submit', status: 'pending' }
          : sub.current.status === 'failed'
            ? {
                kind: 'submit',
                status: 'error',
                message: 'The judge failed to run this submission. Please try again.',
              }
            : {
                kind: 'submit',
                status: 'done',
                passed: sub.current.passed,
                total: sub.current.total,
                results: sub.current.results?.map((r) => ({
                  testCaseIndex: r.testCaseIndex ?? 0,
                  passed: !!r.passed,
                  actual: r.actual ?? '',
                  expected: r.expected ?? '',
                })),
              };
  const totalHints = problem.hints.length;

  return (
    <div className="problem-layout">
      <article className="card problem-text" aria-labelledby="problem-title">
        <h1 id="problem-title">{problem.title}</h1>
        <p>
          <span className={`badge ${problem.difficulty.toLowerCase()}`}>{problem.difficulty}</span>{' '}
          <span className="badge">{problem.topic}</span>
        </p>
        <p className="description">{problem.description}</p>
        <h2>Examples</h2>
        <ul className="examples">
          {problem.testCases.slice(0, 2).map((t, i) => (
            <li key={i}>
              <code>input: {t.input}</code>
              <br />
              <code>output: {t.expected}</code>
            </li>
          ))}
        </ul>
        <h2>Hints</h2>
        {p.hints.length > 0 && (
          <ol className="hints" aria-live="polite">
            {p.hints.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        )}
        <button
          type="button"
          onClick={() => void p.nextHint()}
          disabled={p.hints.length >= totalHints}
        >
          {p.hints.length >= totalHints
            ? 'No more hints'
            : `Show hint ${p.hints.length + 1} of ${totalHints}`}
        </button>
        <h2>Solution</h2>
        {p.solution ? (
          <pre className="solution">
            <code>{p.solution}</code>
          </pre>
        ) : (
          <button type="button" onClick={() => setConfirmOpen(true)}>
            Reveal solution…
          </button>
        )}
        {p.error && (
          <p role="alert" className="error">
            {p.error}
          </p>
        )}
        <ConfirmDialog
          open={confirmOpen}
          title="Reveal the solution?"
          confirmLabel="Reveal"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            void p.revealSolution();
          }}
        >
          <p>
            Looking at the reference solution ends this attempt's challenge. It unlocks after you
            solve the problem.
          </p>
        </ConfirmDialog>
      </article>

      <section className="editor-pane" aria-label="Your solution">
        <div className="editor">
          <Suspense fallback={<p role="status">Loading editor…</p>}>
            <CodeEditor
              value={p.code}
              onChange={p.setCode}
              dark={dark}
              fontSize={editorFontSize}
              onRun={() => void doRun()}
            />
          </Suspense>
        </div>
        <div className="row">
          <button type="button" onClick={() => void doRun()} title="Ctrl/Cmd+Enter">
            Run tests
          </button>
          <button
            type="button"
            className="primary"
            onClick={doSubmit}
            disabled={sub.status === 'submitting' || sub.status === 'judging'}
          >
            {sub.status === 'submitting' || sub.status === 'judging' ? 'Judging…' : 'Submit'}
          </button>
          <button type="button" onClick={() => p.setCode(problem.starterCode)}>
            Reset code
          </button>
        </div>
        <div className="card results-card">
          <h2>Results</h2>
          {(sub.status === 'submitting' || sub.status === 'judging') && (
            <p className="muted">
              {sub.live
                ? 'Live: the result appears as soon as it is judged.'
                : 'Checking for the result every second…'}
            </p>
          )}
          {showResults === 'submit' && sub.status === 'queued' ? (
            // Follows the outbox item: queued → syncing → the server's verdict.
            <p
              role="status"
              className={
                queued?.state === 'synced'
                  ? 'success'
                  : queued?.state === 'conflict' || queued?.state === 'rejected'
                    ? 'error'
                    : undefined
              }
            >
              {!queued || queued.state === 'pending'
                ? 'You are offline. Your submission is queued on this device and will be judged when you reconnect. Watch the sync status at the top.'
                : `${describeQueued(queued)}${queued.message ? `. ${queued.message}` : ''}`}
            </p>
          ) : (
            <ResultsPanel
              view={showResults === 'submit' ? submitView : showResults === 'run' ? run : null}
            />
          )}
          {showResults === 'submit' &&
            sub.status === 'done' &&
            sub.current?.userId === 'offline' && (
              <p className="muted">
                Judged on this computer. It syncs to your account when you reconnect; the
                server&apos;s result counts.
              </p>
            )}
        </div>
      </section>
    </div>
  );
}
