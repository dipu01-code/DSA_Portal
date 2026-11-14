import { randomUUID } from 'crypto';
import { judgeSubmission, statsServiceStub } from '@dsa-portal/workers';
import { buildApp } from '../src/app';
import { InMemoryProblemRepository } from '../src/modules/problems/in-memory-problem.repository';
import { InMemorySubmissionRepository } from '../src/modules/submissions/in-memory-submission.repository';

const TWO_SUM_OK =
  'function solve({ nums, target }) { const m = new Map(); for (let i = 0; i < nums.length; i++) { if (m.has(target - nums[i])) return [m.get(target - nums[i]), i]; m.set(nums[i], i); } }';

describe('REST API behaviour', () => {
  // The app and the "worker" (judgeSubmission) share these in-memory repositories.
  const deps = {
    problems: new InMemoryProblemRepository(),
    submissions: new InMemorySubmissionRepository(),
    stats: statsServiceStub,
  };
  const app = buildApp({ logger: false, problems: deps.problems, submissions: deps.submissions });
  let auth: { authorization: string };
  let otherAuth: { authorization: string };

  beforeAll(async () => {
    await app.ready();
    auth = { authorization: `Bearer ${app.jwt.sign({ sub: randomUUID() })}` };
    otherAuth = { authorization: `Bearer ${app.jwt.sign({ sub: randomUUID() })}` };
  });
  afterAll(() => app.close());

  const post = (code: string, problemId = 'two-sum', headers: Record<string, string> = auth) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers,
      payload: { problemId, code },
    });
  // POST then let the worker judge it, like the real worker process would.
  const submit = async (code: string, problemId = 'two-sum', headers = auth) => {
    const res = await post(code, problemId, headers);
    if (res.statusCode === 202) await judgeSubmission(res.json().submissionId, deps);
    return res;
  };
  const get = (url: string, headers = auth) => app.inject({ method: 'GET', url, headers });

  it('judges a correct and a wrong solution with per-test results', async () => {
    const ok = (
      await get(`/api/v1/submissions/${(await submit(TWO_SUM_OK)).json().submissionId}`)
    ).json();
    expect(ok).toMatchObject({ status: 'judged', passed: 3, total: 3 });
    expect(ok.results[0]).toEqual({
      testCaseIndex: 0,
      passed: true,
      actual: '[0,1]',
      expected: '[0,1]',
    });
    expect(ok.judgedAt).not.toBeNull();

    const bad = (
      await get(
        `/api/v1/submissions/${(await submit('function solve() { return [9, 9]; }')).json().submissionId}`
      )
    ).json();
    expect(bad).toMatchObject({ status: 'judged', passed: 0, total: 3 });
  });

  it('returns 202 queued immediately and leaves judging to the worker', async () => {
    const res = await post(TWO_SUM_OK);
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('queued');
    const queued = (await get(`/api/v1/submissions/${res.json().submissionId}`)).json();
    expect(queued).toMatchObject({ status: 'queued', passed: 0, total: 0, judgedAt: null });

    await judgeSubmission(res.json().submissionId, deps);
    await judgeSubmission(res.json().submissionId, deps); // duplicate delivery is a no-op
    expect((await get(`/api/v1/submissions/${res.json().submissionId}`)).json()).toMatchObject({
      status: 'judged',
      passed: 3,
    });
  });

  it('honours Idempotency-Key: same key returns the same submission, a different body is rejected', async () => {
    const uid = randomUUID();
    const headers = {
      authorization: `Bearer ${app.jwt.sign({ sub: uid })}`,
      'idempotency-key': `k-${randomUUID()}`,
    };
    const first = await post(TWO_SUM_OK, 'two-sum', headers);
    const retry = await post(TWO_SUM_OK, 'two-sum', headers);
    expect(retry.statusCode).toBe(202);
    expect(retry.json().submissionId).toBe(first.json().submissionId);
    expect(await deps.submissions.findByUser(uid)).toHaveLength(1); // nothing created behind the response

    const other = await post('function solve() { return []; }', 'two-sum', headers);
    expect(other.statusCode).toBe(409);
    expect(other.json().error).toBe('IDEMPOTENCY_KEY_REUSED');

    // Keys are per user: someone else may reuse the same key.
    const theirs = await post(TWO_SUM_OK, 'two-sum', {
      ...otherAuth,
      'idempotency-key': headers['idempotency-key'],
    });
    expect(theirs.json().submissionId).not.toBe(first.json().submissionId);
  });

  it('contains hostile code submitted over HTTP', async () => {
    const res = await submit('function solve() { while (true) {} }');
    expect(res.statusCode).toBe(202);
    const sub = (await get(`/api/v1/submissions/${res.json().submissionId}`)).json();
    expect(sub.passed).toBe(0);
  }, 15000);

  it('walks every problem with keyset pagination and rejects a bad cursor', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = (
        await get(`/api/v1/problems?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
      ).json();
      seen.push(...page.data.map((p: { id: string }) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...seen].sort());
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(3);

    expect((await get('/api/v1/problems?cursor=bm9wZQ')).statusCode).toBe(400);
  });

  it('filters problems and returns progressive hints', async () => {
    const easy = (await get('/api/v1/problems?difficulty=Easy')).json();
    expect(easy.data.every((p: { difficulty: string }) => p.difficulty === 'Easy')).toBe(true);
    expect((await get('/api/v1/problems/two-sum/hints?upto=1')).json().hints).toHaveLength(1);
    expect((await get('/api/v1/problems/two-sum/hints')).json().hints).toHaveLength(2);
    expect((await get('/api/v1/problems/two-sum/hints?upto=0')).json().hints).toHaveLength(0);
  });

  it('unlocks the solution only after the user solves the problem', async () => {
    const fresh = { authorization: `Bearer ${app.jwt.sign({ sub: randomUUID() })}` };
    expect((await get('/api/v1/problems/palindrome-number/solution', fresh)).json().error).toBe(
      'SOLUTION_LOCKED'
    );
    await submit('function solve() { return []; }', 'two-sum', fresh);
    expect((await get('/api/v1/problems/two-sum/solution', fresh)).statusCode).toBe(403);
    await submit(TWO_SUM_OK, 'two-sum', fresh);
    expect((await get('/api/v1/problems/two-sum/solution', fresh)).json().solution).toContain(
      'function solve'
    );
  });

  it("lists only the caller's own submissions and hides others' by id", async () => {
    const mine = (await submit(TWO_SUM_OK, 'two-sum', otherAuth)).json().submissionId;
    const list = (await get('/api/v1/submissions?problemId=two-sum', otherAuth)).json();
    expect(list.data.map((s: { id: string }) => s.id)).toContain(mine);
    expect(list.data.every((s: { userId: string }) => s.userId === list.data[0].userId)).toBe(true);
    expect((await get(`/api/v1/submissions/${mine}`)).statusCode).toBe(404);
  });

  it('rejects bad tokens and uses the standard error format everywhere', async () => {
    const res = await get('/api/v1/problems', { authorization: 'Bearer not-a-jwt' });
    expect(res.statusCode).toBe(401);
    const unknown = await get('/api/v1/nope');
    expect(unknown.json()).toMatchObject({
      error: 'NOT_FOUND',
      statusCode: 404,
      path: '/api/v1/nope',
    });
    expect(typeof unknown.json().timestamp).toBe('string');

    const badJson = await app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(badJson.json()).toMatchObject({ error: 'BAD_REQUEST', statusCode: 400 });
  });

  it('echoes or generates x-request-id', async () => {
    expect(
      (await app.inject({ url: '/api/v1/topics', headers: { 'x-request-id': 'abc-123' } })).headers[
        'x-request-id'
      ]
    ).toBe('abc-123');
    expect((await app.inject({ url: '/api/v1/topics' })).headers['x-request-id']).toMatch(
      /[0-9a-f-]{36}/
    );
  });
});
