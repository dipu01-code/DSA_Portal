import { http, HttpResponse, delay } from 'msw';
import type { Submission } from '../api/dsa-api';
import { MOCK_PASSWORD, mockLeaderboard, mockProblems, mockTopics, mockUser } from './fixtures';

/**
 * A small fake of the /api/v1 server for building clients and for tests.
 * Judging rule: a submission passes if its code differs from the starter code and doesn't contain "WRONG".
 */
export function createMockApi(baseUrl = '') {
  const u = (p: string) => `${baseUrl}/api/v1${p}`;
  const state = {
    accessToken: null as string | null,
    hasSession: false,
    issued: 0,
    refreshCalls: 0,
    submissions: new Map<string, Submission & { polls: number }>(),
    byKey: new Map<string, string>(),
    solved: new Set<string>(),
    attempted: new Set<string>(),
  };
  const err = (status: number, error: string, message: string, path = '') =>
    HttpResponse.json(
      { error, message, statusCode: status, timestamp: new Date().toISOString(), path },
      { status }
    );
  const authed = (req: Request) =>
    req.headers.get('authorization') === `Bearer ${state.accessToken}` &&
    state.accessToken !== null;
  const newToken = () => (state.accessToken = `mock-access-${++state.issued}`);
  const find = (id: string) => mockProblems.find((p) => p.id === id);

  const handlers = [
    http.post(u('/auth/register'), async ({ request }) => {
      const b = (await request.json()) as { username: string; email: string };
      if (b.email === mockUser.email) {
        return err(409, 'CONFLICT', 'Username or email already exists');
      }
      return HttpResponse.json(
        { ...mockUser, username: b.username, email: b.email },
        { status: 201 }
      );
    }),
    http.post(u('/auth/login'), async ({ request }) => {
      const b = (await request.json()) as { email: string; password: string };
      if (b.password !== MOCK_PASSWORD) {
        return err(401, 'UNAUTHORIZED', 'Invalid email or password');
      }
      state.hasSession = true;
      return HttpResponse.json({
        accessToken: newToken(),
        refreshToken: 'mock-refresh',
        expiresIn: 900,
      });
    }),
    http.post(u('/auth/refresh'), async () => {
      state.refreshCalls++;
      await delay(10);
      if (!state.hasSession) return err(401, 'UNAUTHORIZED', 'Refresh token is invalid or expired');
      return HttpResponse.json({ accessToken: newToken() });
    }),
    http.post(u('/auth/logout'), () => {
      state.hasSession = false;
      state.accessToken = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(u('/auth/me'), ({ request }) =>
      authed(request)
        ? HttpResponse.json(mockUser)
        : err(401, 'UNAUTHORIZED', 'Missing or invalid access token')
    ),
    http.get(u('/topics'), () => HttpResponse.json({ topics: mockTopics })),
  ];

  // Everything after this needs a valid access token; returning undefined falls through to the next handler.
  const guard = http.all(u('/*'), ({ request }) =>
    authed(request) ? undefined : err(401, 'UNAUTHORIZED', 'Missing or invalid access token')
  );

  const guarded = [
    http.get(u('/problems/random'), ({ request }) => {
      const q = new URL(request.url).searchParams;
      const pool = mockProblems.filter(
        (p) =>
          (!q.get('topic') || p.topic === q.get('topic')) &&
          (!q.get('difficulty') || p.difficulty === q.get('difficulty'))
      );
      return pool.length
        ? HttpResponse.json(pool[0])
        : err(404, 'NOT_FOUND', 'No problem matches these filters');
    }),
    http.get(u('/problems/:id/hints'), ({ params, request }) => {
      const p = find(String(params.id));
      const upto = Number(new URL(request.url).searchParams.get('upto') ?? p?.hints.length);
      return p
        ? HttpResponse.json({ hints: p.hints.slice(0, upto) })
        : err(404, 'NOT_FOUND', 'Problem not found');
    }),
    http.get(u('/problems/:id/solution'), ({ params }) => {
      const p = find(String(params.id));
      if (!p) return err(404, 'NOT_FOUND', 'Problem not found');
      if (!state.solved.has(p.id)) {
        return err(403, 'SOLUTION_LOCKED', 'Solve the problem first to unlock its solution');
      }
      return HttpResponse.json({ solution: p.solution });
    }),
    http.get(u('/problems/:id'), ({ params }) => {
      const p = find(String(params.id));
      return p ? HttpResponse.json(p) : err(404, 'NOT_FOUND', 'Problem not found');
    }),
    http.get(u('/problems'), ({ request }) => {
      const q = new URL(request.url).searchParams;
      const data = mockProblems
        .filter(
          (p) =>
            (!q.get('topic') || p.topic === q.get('topic')) &&
            (!q.get('difficulty') || p.difficulty === q.get('difficulty'))
        )
        .map(({ id, title, topic, difficulty }) => ({ id, title, topic, difficulty }));
      return HttpResponse.json({ data, nextCursor: null });
    }),
    http.post(u('/submissions'), async ({ request }) => {
      const b = (await request.json()) as { problemId: string; code: string };
      const p = find(b.problemId);
      if (!p) return err(404, 'NOT_FOUND', 'Problem not found');
      // Like the server: a retry with the same Idempotency-Key returns the first submission.
      const key = request.headers.get('idempotency-key');
      const replay = key ? state.byKey.get(key) : undefined;
      if (replay) {
        return HttpResponse.json(
          { submissionId: replay, status: state.submissions.get(replay)!.status },
          { status: 202 }
        );
      }
      const id = crypto.randomUUID();
      if (key) state.byKey.set(key, id);
      const ok = b.code !== p.starterCode && !b.code.includes('WRONG');
      const total = p.testCases.length;
      state.submissions.set(id, {
        id,
        problemId: p.id,
        userId: mockUser.id,
        status: 'queued',
        passed: ok ? total : 0,
        total,
        results: p.testCases.map((t, i) => ({
          testCaseIndex: i,
          passed: ok,
          actual: ok ? t.expected : 'null',
          expected: t.expected,
        })),
        createdAt: new Date().toISOString(),
        judgedAt: null,
        polls: 0,
      });
      return HttpResponse.json({ submissionId: id, status: 'queued' }, { status: 202 });
    }),
    // Like the server: the caller's own submissions, newest first, optionally for one problem.
    http.get(u('/submissions'), ({ request }) => {
      const problemId = new URL(request.url).searchParams.get('problemId');
      const data = [...state.submissions.values()]
        .filter((s) => !problemId || s.problemId === problemId)
        .reverse()
        .map(({ polls: _, ...s }) => s);
      return HttpResponse.json({ data, nextCursor: null });
    }),
    http.get(u('/submissions/:id'), ({ params }) => {
      const s = state.submissions.get(String(params.id));
      if (!s) return err(404, 'NOT_FOUND', 'Submission not found');
      // queued on the first poll, judged on the second: exercises the polling loop.
      if (s.polls++ === 0) {
        return HttpResponse.json({ ...s, polls: undefined, passed: 0, total: 0, results: [] });
      }
      s.status = 'judged';
      s.judgedAt ??= new Date().toISOString();
      state.attempted.add(s.problemId);
      if (s.passed === s.total) state.solved.add(s.problemId);
      const { polls: _, ...out } = s;
      return HttpResponse.json(out);
    }),
    http.get(u('/stats/me/streak'), () => {
      const today = new Date().toISOString().slice(0, 10);
      const solvedAny = state.solved.size > 0;
      return HttpResponse.json({
        currentStreak: solvedAny ? 1 : 0,
        longestStreak: solvedAny ? 3 : 0,
        lastSolvedAt: solvedAny ? new Date().toISOString() : null,
        days: solvedAny ? ['2026-11-01', '2026-11-02', '2026-11-03', today] : [],
      });
    }),
    http.get(u('/stats/me/topics'), () => HttpResponse.json({ topics: topicStats() })),
    http.get(u('/stats/me'), () =>
      HttpResponse.json({
        attempted: state.attempted.size,
        solved: state.solved.size,
        totalProblems: mockProblems.length,
        topics: topicStats(),
        difficulties: (['Easy', 'Medium', 'Hard'] as const)
          .map((d) => ({
            difficulty: d,
            attempted: [...state.attempted].filter((id) => find(id)?.difficulty === d).length,
            solved: [...state.solved].filter((id) => find(id)?.difficulty === d).length,
          }))
          .filter((d) => d.attempted > 0),
      })
    ),
    http.get(u('/leaderboard'), ({ request }) => {
      // Opaque offset cursor, like the server.
      const q = new URL(request.url).searchParams;
      const from = Number(q.get('cursor') ?? 0);
      const to = from + Number(q.get('limit') ?? 20);
      return HttpResponse.json({
        data: mockLeaderboard.slice(from, to),
        nextCursor: to < mockLeaderboard.length ? String(to) : null,
      });
    }),
    http.get(u('/daily-challenge'), () =>
      HttpResponse.json({
        date: new Date().toISOString().slice(0, 10),
        problemId: mockProblems[0].id,
        problem: mockProblems[0],
      })
    ),
  ];

  function topicStats() {
    const topics = new Map<string, { topic: string; attempted: number; solved: number }>();
    for (const id of state.attempted) {
      const p = find(id)!;
      const t = topics.get(p.topic) ?? { topic: p.topic, attempted: 0, solved: 0 };
      t.attempted++;
      if (state.solved.has(id)) t.solved++;
      topics.set(p.topic, t);
    }
    return [...topics.values()];
  }

  return {
    handlers: [...handlers, guard, ...guarded],
    state,
    /** Test helper: the next authed call gets a 401, as if the access token had expired. */
    expireAccessToken: () => void (state.accessToken = 'expired'),
  };
}
