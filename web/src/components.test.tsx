import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DsaProvider, type QueuedSubmission } from '@dsa-portal/ui-core';
import { mockServer } from '@dsa-portal/ui-core/mocks/node';
import { dsa } from './platform';
import { SyncStatus } from './components/SyncStatus';
import { ResultsPanel } from './components/ResultsPanel';
import { Splitter } from './components/Splitter';
import { StatsPage } from './pages/StatsPage';
import { ProblemPage } from './pages/ProblemPage';

// Monaco doesn't run in jsdom: a textarea with the same contract.
vi.mock('./components/CodeEditor', () => ({
  CodeEditor: (p: { value: string; onChange(v: string): void }) => (
    <textarea
      aria-label="Code editor"
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
    />
  ),
}));
// jsdom has no Web Worker: "Run" is judged by this fake.
const runInWorker = vi.fn(async (_p: unknown, code: string) => ({
  passed: code.includes('return 1') ? 2 : 0,
  total: 2,
  results: [0, 1].map((i) => ({
    testCaseIndex: i,
    passed: code.includes('return 1'),
    actual: '1',
    expected: '1',
    timeMs: 0.5 + i,
    logs: code.includes('console.log') ? [`log from test ${i + 1}`] : [],
  })),
}));
vi.mock('./run-in-worker', () => ({ runInWorker: (...a: [unknown, string]) => runInWorker(...a) }));

const { server } = mockServer('http://api.test');
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  await dsa.stores.auth.getState().login('demo@dsa.dev', 'demo-pass-1');
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ui = (el: React.ReactElement, path = '/') =>
  render(
    <DsaProvider value={dsa}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/problem/:id" element={el} />
          <Route path="*" element={el} />
        </Routes>
      </MemoryRouter>
    </DsaProvider>
  );

const item = (over: Partial<QueuedSubmission>): QueuedSubmission => ({
  key: Math.random().toString(36),
  problemId: 'two-sum',
  code: 'x',
  userId: null,
  queuedAt: new Date().toISOString(),
  state: 'pending',
  ...over,
});

describe('SyncStatus (sync indicator)', () => {
  afterEach(() =>
    act(() =>
      dsa.stores.sync.setState({ online: true, status: 'online', queue: [], lastError: null })
    )
  );

  it('offline: shows the queued count, explains, and disables Sync now', () => {
    dsa.stores.sync.setState({ online: false, status: 'offline', queue: [item({})] });
    ui(<SyncStatus />);
    expect(screen.getByText('○ Offline · 1 queued')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Offline · 1 queued');
    expect(screen.getByText(/problems you opened before still open/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('flags conflicts and refusals with their messages', () => {
    dsa.stores.sync.setState({
      queue: [
        item({
          state: 'conflict',
          server: { submissionId: 's', status: 'judged', passed: 1, total: 2 },
          message: 'Offline run passed 2/2, the server judged 1/2.',
        }),
        item({
          state: 'rejected',
          message: 'The server refused this submission: Problem not found',
        }),
      ],
    });
    ui(<SyncStatus />);
    expect(screen.getByText('! Online')).toBeTruthy();
    expect(screen.getByText('Conflict · Wrong answer 1/2')).toBeTruthy();
    expect(screen.getByText(/the server judged 1\/2/)).toBeTruthy();
    expect(screen.getByText('Not accepted')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(screen.getByText('Nothing queued.')).toBeTruthy();
  });

  it('Sync now replays the queue and Esc closes the panel', async () => {
    dsa.stores.sync.setState({
      queue: [
        item({
          problemId: 'two-sum',
          code: 'function solve() { return [0, 1]; }',
          userId: dsa.stores.auth.getState().user!.id,
        }),
      ],
    });
    const { container } = ui(<SyncStatus />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Synced · Accepted 2/2')).toBeTruthy();
    fireEvent.keyDown(details, { key: 'Escape' });
    expect(details.open).toBe(false);
  });
});

describe('ResultsPanel', () => {
  it('covers empty, pending, error and a passing run', () => {
    const { rerender } = render(<ResultsPanel view={null} />);
    expect(screen.getByText(/Run your code/)).toBeTruthy();
    rerender(<ResultsPanel view={{ kind: 'run', status: 'pending' }} />);
    expect(screen.getByRole('status').textContent).toBe('Running…');
    rerender(<ResultsPanel view={{ kind: 'submit', status: 'error', message: 'Judge down' }} />);
    expect(screen.getByRole('alert').textContent).toBe('Judge down');
    rerender(
      <ResultsPanel
        view={{
          kind: 'run',
          status: 'done',
          passed: 1,
          total: 1,
          results: [{ testCaseIndex: 0, passed: true, actual: '1', expected: '1' }],
        }}
      />
    );
    expect(screen.getByText('All visible tests pass')).toBeTruthy();
  });
});

describe('StatsPage (charts)', () => {
  it('shows a skeleton while loading, then charts, table and calendar', async () => {
    await dsa.stores.submission.getState().submit('two-sum', 'function solve() { return [0, 1]; }');
    dsa.stores.stats.setState({ summary: null, streak: null });
    ui(<StatsPage />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'By topic' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By difficulty' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Streak calendar' })).toBeTruthy();
    expect(
      screen
        .getAllByRole('listitem')
        .some((d) => d.getAttribute('aria-label')?.endsWith(': solved'))
    ).toBe(true);
    expect(screen.getByRole('rowheader', { name: 'Arrays' })).toBeTruthy(); // accessible table version of the chart
  });

  it('shows an error with a working retry', async () => {
    server.use(
      http.get('http://api.test/api/v1/stats/me', () =>
        HttpResponse.json({ error: 'INTERNAL', message: 'Database unavailable' }, { status: 500 })
      )
    );
    dsa.stores.stats.setState({ summary: null, streak: null });
    ui(<StatsPage />);
    expect(
      await screen.findByText(/Could not load your stats/, {}, { timeout: 5000 })
    ).toBeTruthy();
    server.resetHandlers();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your progress')).toBeTruthy();
  });
});

describe('ProblemPage (problem text)', () => {
  it('renders the description as Markdown: backticks become inline code', async () => {
    ui(<ProblemPage />, '/problem/two-sum');
    const heading = await screen.findByRole('heading', { name: 'Two Sum' });
    const article = heading.closest('article')!;
    const codes = [...article.querySelectorAll('.description code')].map((c) => c.textContent);
    expect(codes).toEqual(['nums', 'target', 'target']);
    expect(article.querySelector('.description')!.textContent).not.toContain('`');
  });

  it('shows a locked solution as a muted note with a lock, not an error; solving unlocks it', async () => {
    ui(<ProblemPage />, '/problem/valid-anagram');
    const note = await screen.findByText('Solve the problem first to unlock its solution.');
    expect(note.className).toBe('muted');
    const reveal = screen.getByRole('button', { name: 'Reveal solution…' });
    expect(reveal.getAttribute('aria-describedby')).toBe('solution-locked');
    expect(reveal.querySelector('svg.icon')).toBeTruthy();

    // The server refuses: still a muted note, never a red alert.
    fireEvent.click(reveal);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal', hidden: true }));
    await waitFor(() => expect(dsa.stores.problem.getState().solutionLocked).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(screen.getByLabelText('Code editor'), {
      target: { value: 'function solve() { return true; }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Accepted')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText('Solve the problem first to unlock its solution.')).toBeNull()
    );
    expect(
      screen.getByRole('button', { name: 'Reveal solution…' }).querySelector('svg')
    ).toBeNull();
  });
});

describe('ProblemPage (editor panel)', () => {
  it('runs, resets, and runs again with Ctrl/Cmd+Enter', async () => {
    ui(<ProblemPage />, '/problem/two-sum');
    const editor = (await screen.findByLabelText('Code editor')) as HTMLTextAreaElement;
    const starter = editor.value;
    fireEvent.click(screen.getByRole('button', { name: 'Run tests' }));
    expect(await screen.findByText('Some tests fail')).toBeTruthy();

    fireEvent.change(editor, { target: { value: 'function solve() { return 1; }' } });
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('All visible tests pass')).toBeTruthy();
    expect(runInWorker).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'two-sum' }),
      'function solve() { return 1; }'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reset code' }));
    expect((screen.getByLabelText('Code editor') as HTMLTextAreaElement).value).toBe(starter);
  });

  it('submits, shows Judging…, then the graded result', async () => {
    ui(<ProblemPage />, '/problem/two-sum');
    fireEvent.change(await screen.findByLabelText('Code editor'), {
      target: { value: 'function solve() { return [0, 1]; }' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('button', { name: 'Judging…' })).toBeTruthy();
    expect(await screen.findByText('Accepted')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy());
  });
});

describe('ProblemPage (Stage 2)', () => {
  it('reveals hints one at a time, then drops the button and focuses the last hint', async () => {
    ui(<ProblemPage />, '/problem/number-of-islands');
    fireEvent.click(await screen.findByRole('button', { name: 'Show hint 1' }));
    expect(await screen.findByText('Think about the brute force first.')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Show hint 2' }));
    expect(await screen.findByText('Can a hash map help?')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Show hint 3' }));
    const last = await screen.findByText('One pass is enough.');
    expect(screen.queryByRole('button', { name: /Show hint|No more hints/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(last.closest('li')));
  });

  it('shows the header: title, difficulty, topic, Previous / Next in catalogue order', async () => {
    ui(<ProblemPage />, '/problem/valid-anagram');
    expect(await screen.findByRole('heading', { level: 1, name: 'Valid Anagram' })).toBeTruthy();
    const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
    expect(header.querySelector('.badge.easy')!.textContent).toBe('Easy');
    expect(header.querySelector('.badge.tag')!.textContent).toBe('Strings');
    const pager = await screen.findByRole('navigation', { name: 'Problems' });
    expect(pager.querySelector('a[href="/problem/two-sum"]')!.textContent).toBe('Previous');
    expect(pager.querySelector('a[href="/problem/longest-substring"]')!.textContent).toBe('Next');
  });

  it('shows examples as Input / Output cards with copy buttons', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    ui(<ProblemPage />, '/problem/two-sum');
    const ex = await screen.findByRole('region', { name: 'Example 1' });
    expect(ex.textContent).toContain('Input');
    expect(ex.textContent).toContain('Output');
    fireEvent.click(screen.getByRole('button', { name: 'Copy input of example 1' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"nums":[2,7,11,15],"target":9}'));
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('Run tests: shortcut in the tooltip, Ctrl/Cmd+Enter runs, Console tab shows the logs', async () => {
    ui(<ProblemPage />, '/problem/two-sum');
    const run = await screen.findByRole('button', { name: 'Run tests' });
    expect(run.title).toBe('Run tests (Ctrl+Enter)'); // jsdom is not a Mac
    expect(run.getAttribute('aria-keyshortcuts')).toBe('Control+Enter Meta+Enter');

    fireEvent.change(screen.getByLabelText('Code editor'), {
      target: { value: 'function solve() { console.log("hi"); return 1; }' },
    });
    runInWorker.mockClear();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    expect(await screen.findByText('All visible tests pass')).toBeTruthy();
    expect(runInWorker).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1.5 ms')).toBeTruthy(); // time per test

    const results = screen.getByRole('tab', { name: 'Results' });
    expect(results.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(results, { key: 'ArrowRight' });
    const consoleTab = screen.getByRole('tab', { name: 'Console' });
    expect(consoleTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(consoleTab);
    expect(screen.getByText('log from test 2')).toBeTruthy();
  });

  it('marks a solved problem with a tick', async () => {
    ui(<ProblemPage />, '/problem/valid-anagram'); // solved in the "locked solution" test above
    expect(await screen.findByText('Solved')).toBeTruthy();
  });
});

describe('ResultsPanel (rows)', () => {
  it('adds an Input column, truncates long values and expands a row to the full values', () => {
    const long = JSON.stringify({ nums: Array.from({ length: 30 }, (_, i) => i), target: 7 });
    render(
      <ResultsPanel
        inputs={[long]}
        view={{
          kind: 'run',
          status: 'done',
          passed: 0,
          total: 1,
          results: [{ testCaseIndex: 0, passed: false, actual: '[1,2]', expected: '[0,1]' }],
        }}
      />
    );
    expect(screen.getByRole('columnheader', { name: 'Input' })).toBeTruthy();
    const cell = screen.getAllByRole('cell')[2];
    expect(cell.textContent!.endsWith('…')).toBe(true);
    expect(cell.textContent!.length).toBeLessThan(long.length);

    const toggle = screen.getByRole('button', { name: 'Test 1 details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(cell); // the whole row is clickable
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = document.getElementById('test-0-details')!;
    expect(details.textContent).toContain('"target": 7'); // full, pretty-printed input
    expect(details.textContent).toContain('29');
    fireEvent.click(toggle); // and the button toggles it back (keyboard: Enter/Space on it)
    expect(document.getElementById('test-0-details')).toBeNull();
  });
});

describe('Splitter', () => {
  it('moves with the arrow keys within its limits', () => {
    let value = 0.4;
    const ref = { current: document.body };
    const { rerender } = render(
      <Splitter
        label="Resize"
        orientation="vertical"
        container={ref}
        value={value}
        min={0.2}
        max={0.8}
        onChange={(v) => (value = v)}
      />
    );
    const sep = screen.getByRole('separator', { name: 'Resize' });
    expect(sep.tabIndex).toBe(0);
    expect(sep.getAttribute('aria-valuenow')).toBe('40');
    fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(value).toBeCloseTo(0.45);
    fireEvent.keyDown(sep, { key: 'End' });
    expect(value).toBe(0.8);
    rerender(
      <Splitter
        label="Resize"
        orientation="vertical"
        container={ref}
        value={value}
        min={0.2}
        max={0.8}
        onChange={(v) => (value = v)}
      />
    );
    expect(sep.getAttribute('aria-valuenow')).toBe('80');
  });

  it('remembers the problem page split in localStorage', async () => {
    localStorage.removeItem('dsa.problem.split.left');
    ui(<ProblemPage />, '/problem/two-sum');
    const sep = await screen.findByRole('separator', { name: 'Resize description and editor' });
    fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(localStorage.getItem('dsa.problem.split.left')).toBe('0.35');
  });
});
