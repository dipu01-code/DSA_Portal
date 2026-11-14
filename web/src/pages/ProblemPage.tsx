import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import { ConsolePanel, ResultsPanel, type ResultsView } from '../components/ResultsPanel';
import { InlineMarkdown, Markdown } from '../components/Markdown';
import { Icon } from '../components/Icon';
import { Examples } from '../components/Examples';
import { Tabs } from '../components/Tabs';
import { Splitter, useStoredSize } from '../components/Splitter';
import { isAccepted, useSolved } from '../use-solved';
import { useProblemList } from '../use-problem-list';
import { desktop } from '../platform';
import { runInWorker } from '../run-in-worker';

// Monaco is ~3 MB: load it only on this page.
const CodeEditor = lazy(() =>
  import('../components/CodeEditor').then((m) => ({ default: m.CodeEditor }))
);

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const RUN_SHORTCUT = IS_MAC ? '⌘+Enter' : 'Ctrl+Enter';

export function ProblemPage() {
  const { id = '' } = useParams();
  const p = useProblem();
  const sub = useSubmissionStatus();
  const { editorFontSize } = useSettings();
  const [run, setRun] = useState<ResultsView | null>(null);
  const [showResults, setShowResults] = useState<'run' | 'submit' | null>(null);
  const [tab, setTab] = useState<'results' | 'console'>('results');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dark = useStore(themeMode).mode === 'dark';
  const { queue } = useSync();
  const queued = sub.queuedKey ? queue.find((q) => q.key === sub.queuedKey) : undefined;
  const list = useProblemList();

  // Pane sizes: description vs right side, and editor vs results; remembered for next time.
  const layoutRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLElement>(null);
  const [left, setLeft, leftMin, leftMax] = useStoredSize('dsa.problem.split.left', 0.4);
  const [top, setTop, topMin, topMax] = useStoredSize('dsa.problem.split.top', 0.6);

  useEffect(() => {
    if (p.problem?.id !== id) void p.load(id);
    sub.reset();
    setRun(null);
    setShowResults(null);
    // Only when the route's problem changes: p and sub are stores, not inputs.
  }, [id]);

  // Accepted here and now counts at once; otherwise ask the server (null = unknown, e.g. offline).
  const acceptedNow = sub.status === 'done' && !!sub.current && isAccepted(sub.current);
  const solvedOnServer = useSolved(id, acceptedNow);
  const solved = acceptedNow || solvedOnServer;
  // A fresh solve unlocks it even if an earlier reveal was refused.
  const solutionLocked = !p.solution && !solved && (solved === false || p.solutionLocked);

  // After the last hint is revealed its button goes away: move focus to that hint, not to <body>.
  const hintsRef = useRef<HTMLOListElement>(null);
  const shownHints = useRef(p.hints.length);
  useEffect(() => {
    const total = p.problem?.hints.length ?? 0;
    if (p.hints.length > shownHints.current && p.hints.length >= total) {
      hintsRef.current?.querySelector<HTMLElement>('li:last-child')?.focus();
    }
    shownHints.current = p.hints.length;
  }, [p.hints.length, p.problem]);

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
  if (!p.problem) {
    return (
      <p role="alert" className="error">
        {p.error}
      </p>
    );
  }
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
  const view = showResults === 'submit' ? submitView : showResults === 'run' ? run : null;
  const totalHints = problem.hints.length;
  const at = list?.findIndex((s) => s.id === problem.id) ?? -1;
  const prev = at > 0 ? list![at - 1] : undefined;
  const next = at >= 0 && at < list!.length - 1 ? list![at + 1] : undefined;
  const judging = sub.status === 'submitting' || sub.status === 'judging';

  return (
    <div
      className="problem-layout"
      ref={layoutRef}
      style={{ '--left': `${left * 100}%`, '--top': `${top * 100}%` } as React.CSSProperties}
    >
      <article className="card problem-text" aria-labelledby="problem-title">
        <header className="problem-header">
          <div className="title-row">
            <h1 id="problem-title">{problem.title}</h1>
            {solved && (
              <span className="badge solved with-icon">
                <Icon name="check" size={12} />
                Solved
              </span>
            )}
          </div>
          <p className="meta">
            <span className={`badge ${problem.difficulty.toLowerCase()}`}>
              {problem.difficulty}
            </span>
            {/* The API gives each problem one topic (no tag list). */}
            <span className="badge tag">{problem.topic}</span>
          </p>
          {list && (
            <nav className="row pager" aria-label="Problems">
              {prev ? (
                <Link
                  className="button-link with-icon"
                  to={`/problem/${prev.id}`}
                  title={prev.title}
                >
                  <Icon name="left" />
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  className="button-link with-icon"
                  to={`/problem/${next.id}`}
                  title={next.title}
                >
                  Next
                  <Icon name="right" />
                </Link>
              )}
            </nav>
          )}
        </header>

        <Markdown text={problem.description} className="description" />

        <h2>Examples</h2>
        <Examples cases={problem.testCases.slice(0, 2)} />

        <h2>Hints</h2>
        {totalHints === 0 && <p className="muted">This problem has no hints.</p>}
        {p.hints.length > 0 && (
          <ol className="hints" aria-live="polite" ref={hintsRef}>
            {p.hints.map((h, i) => (
              <li key={i} tabIndex={-1}>
                <InlineMarkdown text={h} />
              </li>
            ))}
          </ol>
        )}
        {p.hints.length < totalHints && (
          <button type="button" onClick={() => void p.nextHint()}>
            Show hint {p.hints.length + 1}
          </button>
        )}

        <h2>Solution</h2>
        {p.solution ? (
          <pre className="solution">
            <code>{p.solution}</code>
          </pre>
        ) : (
          <>
            <button
              type="button"
              className="with-icon"
              onClick={() => setConfirmOpen(true)}
              aria-describedby={solutionLocked ? 'solution-locked' : undefined}
            >
              {solutionLocked && <Icon name="lock" />}
              Reveal solution…
            </button>
            {/* Server is the authority: the button stays usable in case this device's view is stale. */}
            {solutionLocked && (
              <p id="solution-locked" className="muted">
                Solve the problem first to unlock its solution.
              </p>
            )}
          </>
        )}
        {p.error && !p.solutionLocked && (
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

      <Splitter
        label="Resize description and editor"
        orientation="vertical"
        container={layoutRef}
        value={left}
        min={leftMin}
        max={leftMax}
        onChange={setLeft}
      />

      <section className="editor-pane" aria-label="Your solution" ref={rightRef}>
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
          <button
            type="button"
            onClick={() => void doRun()}
            title={`Run tests (${RUN_SHORTCUT})`}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            Run tests
          </button>
          <button type="button" className="primary" onClick={doSubmit} disabled={judging}>
            {judging ? 'Judging…' : 'Submit'}
          </button>
          <button type="button" onClick={() => p.setCode(problem.starterCode)}>
            Reset code
          </button>
        </div>
        <Splitter
          label="Resize editor and results"
          orientation="horizontal"
          container={rightRef}
          value={top}
          min={topMin}
          max={topMax}
          onChange={setTop}
        />
        <div className="card results-card">
          <Tabs<'results' | 'console'>
            label="Output"
            tabs={[
              { id: 'results', label: 'Results' },
              { id: 'console', label: 'Console' },
            ]}
            selected={tab}
            onSelect={setTab}
          >
            {judging && (
              <p className="muted">
                {sub.live
                  ? 'Live: the result appears as soon as it is judged.'
                  : 'Checking for the result every second…'}
              </p>
            )}
            {tab === 'console' ? (
              <ConsolePanel view={view} />
            ) : showResults === 'submit' && sub.status === 'queued' ? (
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
              <ResultsPanel view={view} inputs={problem.testCases.map((t) => t.input)} />
            )}
            {showResults === 'submit' &&
              sub.status === 'done' &&
              sub.current?.userId === 'offline' && (
                <p className="muted">
                  Judged on this computer. It syncs to your account when you reconnect; the
                  server&apos;s result counts.
                </p>
              )}
          </Tabs>
        </div>
      </section>
    </div>
  );
}
