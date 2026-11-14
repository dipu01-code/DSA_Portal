import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  createDsa,
  DsaProvider,
  ApiError,
  type DsaApi,
  type Problem,
  type Submission,
} from '@dsa-portal/ui-core';
import Login from '../app/login';
import Practice from '../app/(app)/(tabs)/index';
import ProblemScreen from '../app/(app)/problem/[id]';
import Stats from '../app/(app)/(tabs)/stats';
import Leaderboard from '../app/(app)/(tabs)/leaderboard';
import Settings from '../app/(app)/(tabs)/settings';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ id: 'two-sum' }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>redirect:{href}</Text>;
  },
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

const problem: Problem = {
  id: 'two-sum',
  title: 'Two Sum',
  topic: 'Arrays',
  difficulty: 'Easy',
  description: 'Find two numbers.',
  starterCode: 'function solve(input) {\n}\n',
  testCases: [{ input: '{"nums":[2,7],"target":9}', expected: '[0,1]' }],
  hints: ['Use a map', 'One pass'],
  solution: '',
};
const judged = (passed: number): Submission => ({
  id: 's1',
  problemId: 'two-sum',
  userId: 'u',
  status: 'judged',
  passed,
  total: 1,
  createdAt: new Date().toISOString(),
  judgedAt: new Date().toISOString(),
  results: [
    { testCaseIndex: 0, passed: passed === 1, actual: passed ? '[0,1]' : '[]', expected: '[0,1]' },
  ],
});

/** The real ui-core stores on top of a fake API: screens are tested exactly as they run. */
function setup(
  overrides: Partial<DsaApi> = {},
  extra: Partial<Parameters<typeof createDsa>[0]> = {}
) {
  let polls = 0;
  const api = {
    login: jest.fn(async ({ password }: { password: string }) => {
      if (password !== 'right-pass-1')
        throw new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password');
      return { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
    }),
    me: async () => ({
      id: 'u',
      username: 'mia',
      email: 'mia@x.io',
      role: 'user' as const,
      createdAt: '',
    }),
    topics: async () => ['Arrays', 'Graphs'],
    randomProblem: jest.fn(async () => problem),
    problem: async () => problem,
    hints: async (_id: string, upto: number) => problem.hints.slice(0, upto),
    solution: async () => {
      throw new ApiError(403, 'SOLUTION_LOCKED', 'locked');
    },
    submit: jest.fn(async () => ({ submissionId: 's1', status: 'queued' })),
    submission: async () =>
      polls++ === 0 ? { ...judged(0), status: 'queued' as const } : judged(1),
    leaderboard: async () => ({
      data: [
        { userId: 'x', username: 'ada', solved: 9, totalScore: 20, rank: 1 },
        { userId: 'u', username: 'mia', solved: 1, totalScore: 1, rank: 2 },
      ],
      nextCursor: null,
    }),
    dailyChallenge: async () => ({ date: '2026-11-13', problemId: 'two-sum', problem }),
    stats: async () => ({
      attempted: 1,
      solved: 1,
      totalProblems: 40,
      topics: [{ topic: 'Arrays', attempted: 1, solved: 1 }],
      difficulties: [{ difficulty: 'Easy' as const, attempted: 1, solved: 1 }],
      streak: { currentStreak: 2, longestStreak: 4, lastSolvedAt: null },
    }),
    streak: async () => ({
      currentStreak: 2,
      longestStreak: 4,
      lastSolvedAt: null,
      days: ['2026-11-12'],
    }),
    ...overrides,
  } as unknown as DsaApi;
  const dsa = createDsa({
    baseUrl: 'http://api.test',
    refresh: async () => null,
    wrapApi: () => api,
    pollMs: 1,
    ...extra,
  });
  const ui = (el: React.ReactElement) => render(<DsaProvider value={dsa}>{el}</DsaProvider>);
  return { dsa, api, ui };
}

describe('Login screen', () => {
  it('shows the server error, then signs in and redirects', async () => {
    const { ui } = setup();
    ui(<Login />);
    fireEvent.changeText(screen.getByLabelText('Email'), ' mia@x.io ');
    fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Password'), 'right-pass-1');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('redirect:/')).toBeTruthy();
  });
});

describe('Practice screen', () => {
  it('picks topic + difficulty and opens a random problem', async () => {
    const { ui, api } = setup();
    ui(<Practice />);
    fireEvent.press(await screen.findByRole('radio', { name: 'Graphs' }));
    fireEvent.press(screen.getByRole('radio', { name: 'Hard' }));
    fireEvent.press(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/problem/two-sum'));
    expect(api.randomProblem).toHaveBeenCalledWith({ topic: 'Graphs', difficulty: 'Hard' });
  });
});

describe('Problem screen', () => {
  it('edits with the key bar, submits, polls and shows per-test results', async () => {
    const { ui, api } = setup();
    ui(<ProblemScreen />);
    const editor = await screen.findByLabelText('Code editor');
    fireEvent.changeText(editor, 'function solve({ nums }) { return “x”; }');
    expect(screen.getByLabelText('Code editor').props.value).toBe(
      'function solve({ nums }) { return "x"; }'
    );
    fireEvent(screen.getByLabelText('Code editor'), 'selectionChange', {
      nativeEvent: { selection: { start: 0, end: 0 } },
    });
    fireEvent.press(screen.getByRole('button', { name: 'Indent' }));
    expect(screen.getByLabelText('Code editor').props.value.startsWith('  function')).toBe(true);

    fireEvent.press(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Accepted · 1/1 passed')).toBeTruthy();
    expect(api.submit).toHaveBeenCalledWith(
      { problemId: 'two-sum', code: expect.stringContaining('function solve') },
      expect.any(String)
    );
  });

  it('reveals hints one by one and confirms before the (locked) solution', async () => {
    const { ui } = setup();
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    ui(<ProblemScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Show hint 1 of 2' }));
    expect(await screen.findByText('1. Use a map')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Reveal solution…' }));
    expect(alert).toHaveBeenCalled();
    expect(await screen.findByText('Solve the problem first to unlock its solution')).toBeTruthy();
  });
});

describe('Day 7: leaderboard + daily challenge', () => {
  it('lists ranks and marks the signed-in user', async () => {
    const { ui, dsa } = setup();
    await act(() => dsa.stores.auth.getState().login('mia@x.io', 'right-pass-1'));
    ui(<Leaderboard />);
    expect(await screen.findByLabelText('Rank 1, ada, 9 solved, score 20')).toBeTruthy();
    expect(screen.getByLabelText('Rank 2, mia (you), 1 solved, score 1')).toBeTruthy();
  });

  it('practice shows the daily challenge and opens it', async () => {
    const { ui } = setup();
    ui(<Practice />);
    fireEvent.press(await screen.findByRole('button', { name: "Solve today's challenge" }));
    expect(mockPush).toHaveBeenCalledWith('/problem/two-sum');
  });
});

describe('Stats screen', () => {
  it('shows tiles, accessible bars and the calendar', async () => {
    const { ui, dsa } = setup();
    ui(<Stats />);
    expect(await screen.findByLabelText('Solved: 1/40')).toBeTruthy();
    expect(screen.getByLabelText('Streak: 2 d, longest 4 d')).toBeTruthy();
    expect(screen.getByLabelText('Arrays: 1 solved of 1 attempted, accuracy 100%')).toBeTruthy();
    expect(screen.getByLabelText('Streak calendar, 1 solve days')).toBeTruthy();
    await act(() => dsa.stores.stats.getState().load());
  });

  it('shows an error with a retry', async () => {
    const { ui } = setup({
      stats: async () => {
        throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
      },
    });
    ui(<Stats />);
    expect(
      await screen.findByText(
        'Could not load your stats: No connection to the server. Check your network and try again.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('Day 8: offline outbox, settings, saved problems', () => {
  it('queues an offline submit, then Settings → Sync now judges it on the server', async () => {
    const offline = new ApiError(0, 'NETWORK_ERROR', 'Network request failed');
    const { ui, dsa, api } = setup();
    await act(() => dsa.stores.auth.getState().login('mia@x.io', 'right-pass-1'));
    (api.submit as jest.Mock).mockRejectedValueOnce(offline);
    ui(<ProblemScreen />);
    fireEvent.press(await screen.findByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/Your submission is queued on this phone/)).toBeTruthy();
    // The problem screen follows the queued item until the server has judged it (Day 9 bug 3).
    await act(() => dsa.stores.sync.getState().syncNow());
    expect(await screen.findByText('Synced · Accepted 1/1')).toBeTruthy();
    screen.unmount();
    dsa.stores.sync.setState((s) => ({
      queue: s.queue.map((q) => ({ ...q, state: 'pending' as const, server: undefined })),
    }));

    ui(<Settings />);
    expect(screen.getByText('Online · 1 queued')).toBeTruthy();
    expect(screen.getByText('Waiting to sync')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Synced · Accepted 1/1')).toBeTruthy();
    // Replayed with the key of the original click, so a lost response can't double-submit.
    const [first, replay] = (api.submit as jest.Mock).mock.calls;
    expect(replay[1]).toBe(first[1]);
    fireEvent.press(screen.getByRole('button', { name: 'Clear finished' }));
    expect(await screen.findByText(/Nothing queued/)).toBeTruthy();
  });

  it('switches the theme from Settings', async () => {
    const { ui, dsa } = setup();
    ui(<Settings />);
    fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
    expect(dsa.stores.settings.getState().theme).toBe('dark');
  });

  it('lists problems saved on the phone while offline', async () => {
    const network = { isOnline: () => false, subscribe: () => () => {} };
    const problems = jest.fn(async () => ({
      data: [{ id: 'two-sum', title: 'Two Sum', topic: 'Arrays', difficulty: 'Easy' as const }],
      nextCursor: null,
    }));
    const { ui } = setup(
      {
        problems,
        dailyChallenge: async () => {
          throw new ApiError(0, 'NETWORK_ERROR', 'offline');
        },
      },
      { network }
    );
    ui(<Practice />);
    fireEvent.press(await screen.findByRole('button', { name: 'Two Sum · Easy' }));
    expect(mockPush).toHaveBeenCalledWith('/problem/two-sum');
    expect(screen.getByText('On this phone')).toBeTruthy();
  });
});
