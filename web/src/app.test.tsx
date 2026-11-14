import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { DsaProvider } from '@dsa-portal/ui-core';
import { mockServer } from '@dsa-portal/ui-core/mocks/node';
import { App } from './App';
import { dsa } from './platform';
import { ResultsPanel } from './components/ResultsPanel';

// Monaco doesn't run in jsdom; the problem page only needs some editor here.
vi.mock('./components/CodeEditor', () => ({
  CodeEditor: () => <textarea aria-label="Code editor" />,
}));

const { server, mock } = mockServer('http://api.test');
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

const renderApp = (hash = '#/') => {
  window.location.hash = hash;
  return render(
    <DsaProvider value={dsa}>
      <App />
    </DsaProvider>
  );
};

describe('web app', () => {
  it('sends anonymous users to login, signs in, then shows the topic picker', async () => {
    await dsa.stores.auth.getState().restore(); // no session yet → anonymous
    renderApp('#/');
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'demo@dsa.dev' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo-pass-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Practice' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Graphs' })).toBeTruthy());
  });

  it('stats page shows the empty state, then numbers after a solve', async () => {
    const { unmount } = renderApp('#/stats');
    expect(await screen.findByText(/No attempts yet/)).toBeTruthy();
    unmount();
    await dsa.stores.submission.getState().submit('two-sum', 'function solve() { return [0, 1]; }');
    renderApp('#/stats');
    expect(await screen.findByText('1/5')).toBeTruthy();
    expect(screen.getAllByText('100%')).toHaveLength(2); // accuracy tile + table row
    expect(screen.getByRole('heading', { name: 'By topic' })).toBeTruthy();
    expect(mock.state.solved.has('two-sum')).toBe(true);
  });
});

describe('Day 7 screens', () => {
  it('leaderboard lists ranked users and marks you', async () => {
    renderApp('#/leaderboard');
    expect(await screen.findByRole('heading', { name: 'Leaderboard' })).toBeTruthy();
    expect(await screen.findByText('ada')).toBeTruthy();
    expect(screen.getByText('demo (you)').closest('tr')?.getAttribute('aria-current')).toBe('true');
  });

  it('home shows the daily challenge card linking to the problem', async () => {
    renderApp('#/');
    fireEvent.click(await screen.findByRole('button', { name: "Solve today's challenge" }));
    expect(await screen.findByRole('heading', { name: 'Two Sum', level: 1 })).toBeTruthy();
  });
});

describe('Day 8: offline submit → reconnect → synced', () => {
  const setNetwork = (online: boolean) => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  };

  it('queues the submission while offline and shows every sync step', async () => {
    renderApp('#/problem/two-sum');
    expect(await screen.findByRole('heading', { name: 'Two Sum', level: 1 })).toBeTruthy();
    dsa.stores.problem.getState().setCode('function solve({ nums, target }) { return [0, 1]; }');

    setNetwork(false);
    server.use(
      http.post('http://api.test/api/v1/submissions', () => HttpResponse.error(), { once: true })
    );
    expect(await screen.findByText('○ Offline')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Your submission is queued on this device/)).toBeTruthy();
    expect(screen.getByText('○ Offline · 1 queued')).toBeTruthy();
    expect(screen.getByText('Waiting to sync')).toBeTruthy();

    setNetwork(true); // reconnect → the outbox replays it with the same Idempotency-Key
    // Both the sync panel and the problem page (which follows the queued item) show the verdict.
    await waitFor(() => expect(screen.getAllByText('Synced · Accepted 2/2')).toHaveLength(2));
    expect(screen.getByText('● Online')).toBeTruthy();
    expect(screen.getAllByRole('status').some((el) => el.textContent === 'Online')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(screen.getByText('Nothing queued.')).toBeTruthy();
  });

  it('lists problems opened before while the browser is offline', async () => {
    setNetwork(false);
    server.use(http.get('http://api.test/api/v1/*', () => HttpResponse.error()));
    renderApp('#/');
    expect(await screen.findByRole('heading', { name: 'On this device' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Two Sum' }));
    expect(await screen.findByRole('heading', { name: 'Two Sum', level: 1 })).toBeTruthy();
    server.resetHandlers();
    setNetwork(true);
  });
});

describe('ResultsPanel', () => {
  it('shows per-test rows with errors', () => {
    render(
      <ResultsPanel
        view={{
          kind: 'submit',
          status: 'done',
          passed: 1,
          total: 2,
          results: [
            { testCaseIndex: 0, passed: true, actual: '1', expected: '1' },
            { testCaseIndex: 1, passed: false, actual: '', expected: '2', error: 'boom' },
          ],
        }}
      />
    );
    expect(screen.getByText('Wrong answer')).toBeTruthy();
    expect(screen.getByText('Error: boom')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
