import { judgeSubmission } from '@dsa-portal/workers';
import { buildPerson3App, bearer } from './helpers/person3-app';
import { computeStreak } from '../src/modules/stats/stats.service';

const TWO_SUM_OK =
  'function solve({ nums, target }) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }';

describe('computeStreak (UTC days)', () => {
  const at = (iso: string) => new Date(iso);
  const now = at('2026-11-12T10:00:00Z');
  it('is empty with no solves', () =>
    expect(computeStreak([], now)).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastSolvedAt: null,
    }));
  it('counts consecutive days ending today or yesterday', () => {
    const days = [
      '2026-11-09T23:59:00Z',
      '2026-11-10T00:01:00Z',
      '2026-11-10T12:00:00Z',
      '2026-11-11T08:00:00Z',
    ].map(at);
    expect(computeStreak(days, now)).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      lastSolvedAt: '2026-11-11T08:00:00.000Z',
    });
  });
  it('breaks after a missed day but keeps the longest', () => {
    const days = [
      '2026-11-01T10:00:00Z',
      '2026-11-02T10:00:00Z',
      '2026-11-03T10:00:00Z',
      '2026-11-10T10:00:00Z',
    ].map(at);
    expect(computeStreak(days, now)).toMatchObject({ currentStreak: 0, longestStreak: 3 });
  });
  it('uses UTC: 23:30 and 00:30 UTC are two days', () => {
    expect(
      computeStreak([at('2026-11-11T23:30:00Z'), at('2026-11-12T00:30:00Z')], now).currentStreak
    ).toBe(2);
  });
});

describe('stats API', () => {
  const { app, call, deps } = buildPerson3App();
  let auth: Record<string, string>;
  beforeAll(async () => {
    await app.ready();
    await call('POST', '/auth/register', {
      payload: { username: 'stan', email: 'stan@x.io', password: 'stats-pass-1' },
    });
    auth = bearer(
      (
        await call('POST', '/auth/login', {
          payload: { email: 'stan@x.io', password: 'stats-pass-1' },
        })
      ).json().accessToken
    );
  });
  afterAll(() => app.close());

  const submit = async (problemId: string, code: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: auth,
      payload: { problemId, code },
    });
    await judgeSubmission(res.json().submissionId, deps);
  };

  it('starts empty', async () => {
    const me = (await call('GET', '/stats/me', { headers: auth })).json();
    expect(me).toMatchObject({
      attempted: 0,
      solved: 0,
      topics: [],
      difficulties: [],
      streak: { currentStreak: 0, lastSolvedAt: null },
    });
    expect(me.totalProblems).toBeGreaterThan(0);
  });

  it('counts attempted/solved per problem, topic and difficulty, and starts a streak', async () => {
    await submit('two-sum', 'function solve() { return []; }'); // wrong
    await submit('two-sum', TWO_SUM_OK); // right
    await submit('two-sum', 'function solve() { return []; }'); // wrong again: stays solved
    const me = (await call('GET', '/stats/me', { headers: auth })).json();
    expect(me).toMatchObject({
      attempted: 1,
      solved: 1,
      streak: { currentStreak: 1, longestStreak: 1 },
    });
    expect(me.topics).toEqual([{ topic: 'Arrays', attempted: 1, solved: 1 }]);
    expect(me.difficulties).toEqual([{ difficulty: 'Easy', attempted: 1, solved: 1 }]);
    expect((await call('GET', '/stats/me/topics', { headers: auth })).json()).toEqual({
      topics: me.topics,
    });

    const streak = (await call('GET', '/stats/me/streak', { headers: auth })).json();
    expect(streak).toMatchObject({
      currentStreak: 1,
      days: [new Date().toISOString().slice(0, 10)],
    });
  });

  it('requires a token', async () => {
    for (const p of ['/stats/me', '/stats/me/topics', '/stats/me/streak']) {
      expect((await call('GET', p)).statusCode).toBe(401);
    }
  });
});
