import { randomUUID } from 'crypto';
import type { Submission } from '@dsa-portal/core';
import { buildApp } from '../src/app';
import { InMemorySubmissionRepository } from '../src/modules/submissions/in-memory-submission.repository';
import { rankRows } from '../src/modules/leaderboard/routes';
import { pickDaily, utcDate } from '../src/modules/daily/store';

const DAY = 24 * 60 * 60 * 1000;

describe('leaderboard ranking', () => {
  it('ranks by solved count, then by who got there first, then user id', () => {
    const at = (ms: number) => new Date(ms);
    const ranked = rankRows([
      { userId: 'c', username: 'c', solved: 2, totalScore: 3, lastSolvedAt: at(500) },
      { userId: 'a', username: 'a', solved: 3, totalScore: 3, lastSolvedAt: at(900) },
      { userId: 'b', username: 'b', solved: 2, totalScore: 6, lastSolvedAt: at(100) },
      { userId: 'd', username: 'd', solved: 2, totalScore: 2, lastSolvedAt: at(100) },
    ]);
    expect(ranked.map((r) => `${r.rank}:${r.userId}`)).toEqual(['1:a', '2:b', '3:d', '4:c']);
  });
});

describe('GET /leaderboard and /daily-challenge (in-memory)', () => {
  const submissions = new InMemorySubmissionRepository();
  const app = buildApp({ logger: false, submissions });
  const solve = (userId: string, problemId: string, judgedAt: Date, passed = true) => {
    const s: Submission = {
      id: randomUUID(),
      problemId,
      userId,
      code: 'x',
      status: 'judged',
      createdAt: judgedAt,
      judgedAt,
      result: {
        problemId,
        status: passed ? 'passed' : 'failed',
        perTest: [{ id: '0', passed, expected: 1, actual: passed ? 1 : 2, runtimeMs: 1 }],
      },
    };
    return submissions.save(s);
  };
  const [u1, u2, u3] = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    await app.ready();
    const now = Date.now();
    await solve(u1, 'two-sum', new Date(now - 30 * DAY)); // old solve: counts for all, not for week
    await solve(u1, 'valid-parentheses', new Date(now - DAY));
    await solve(u1, 'valid-parentheses', new Date(now - 1000)); // a re-solve is not a second solve
    await solve(u2, 'two-sum', new Date(now - 2 * DAY));
    await solve(u3, 'two-sum', new Date(now - DAY), false); // failed: not on the board
  });
  afterAll(() => app.close());

  const board = async (q: string) => (await app.inject({ url: `/api/v1/leaderboard${q}` })).json();

  it('counts first solves only and filters by period', async () => {
    expect(
      (await board('')).data.map((r: { userId: string; solved: number; rank: number }) => [
        r.userId,
        r.solved,
        r.rank,
      ])
    ).toEqual([
      [u1, 2, 1],
      [u2, 1, 2],
    ]);
    // Last 7 days: one each, and u2 got there first.
    expect((await board('?period=week')).data.map((r: { userId: string }) => r.userId)).toEqual([
      u2,
      u1,
    ]);
  });

  it('pages with a keyset cursor and keeps ranks across pages', async () => {
    const p1 = await board('?limit=1');
    const p2 = await board(`?limit=1&cursor=${p1.nextCursor}`);
    expect([p1.data[0].rank, p2.data[0].rank]).toEqual([1, 2]);
    expect(p2.nextCursor).toBeNull();
    expect((await app.inject({ url: '/api/v1/leaderboard?cursor=bm9wZQ' })).statusCode).toBe(400);
  });

  it("serves today's daily challenge, the same for everyone", async () => {
    const get = (sub: string) =>
      app.inject({
        url: '/api/v1/daily-challenge',
        headers: { authorization: `Bearer ${app.jwt.sign({ sub })}` },
      });
    const [a, b] = await Promise.all([get(u1), get(u2)]);
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(a.json()).toMatchObject({ date: utcDate() });
    expect(a.json().problem.id).toBe(a.json().problemId);
  });
});

describe('pickDaily', () => {
  const ids = ['b', 'a', 'c', 'd', 'e'];
  it('is deterministic and ignores list order', () => {
    expect(pickDaily('2026-11-13', ids)).toBe(pickDaily('2026-11-13', [...ids].reverse()));
  });
  it('varies across days and handles an empty list', () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      utcDate(new Date(Date.UTC(2026, 0, 1) + i * DAY))
    );
    expect(new Set(days.map((d) => pickDaily(d, ids))).size).toBeGreaterThan(1);
    expect(pickDaily('2026-11-13', [])).toBeNull();
  });
});
