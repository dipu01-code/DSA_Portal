import { randomUUID } from 'crypto';
import { buildApp } from '../src/app';
import type { AuthStore } from '../src/modules/auth/store';
import { InMemorySubmissionRepository } from '../src/modules/submissions/in-memory-submission.repository';

const ADMIN = randomUUID();
const auth = {
  findById: async (id: string) => ({
    id,
    username: 'u',
    email: 'u@x.dev',
    role: id === ADMIN ? ('admin' as const) : ('user' as const),
    createdAt: new Date(),
  }),
};

describe('Day 6: backpressure and the dead-letter admin API', () => {
  const submissions = new InMemorySubmissionRepository();
  const app = buildApp({
    logger: false,
    submissions,
    auth: auth as unknown as AuthStore,
    backpressure: { maxWaiting: 2, retryAfterS: 7 },
  });
  const bearer = (sub: string) => ({ authorization: `Bearer ${app.jwt.sign({ sub })}` });
  const user = randomUUID();
  const post = (headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      headers: { ...bearer(user), ...headers },
      payload: { problemId: 'two-sum', code: 'x' },
    });

  beforeAll(() => app.ready());
  afterAll(() => app.close());

  it('returns 429 with Retry-After once the waiting queue reaches the limit, but still replays idempotent retries', async () => {
    expect((await post({ 'idempotency-key': 'k1' })).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(202);
    const full = await post();
    expect(full.statusCode).toBe(429);
    expect(full.headers['retry-after']).toBe('7');
    expect(full.json()).toMatchObject({ error: 'QUEUE_FULL', statusCode: 429 });
    expect((await post({ 'idempotency-key': 'k1' })).statusCode).toBe(202); // a replay adds no load
  });

  it('lists failed submissions for admins only and requeues them', async () => {
    const [first] = submissions.all();
    first.status = 'failed';
    first.judgedAt = new Date();

    expect((await app.inject({ url: '/api/v1/admin/queue/failed' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/admin/queue/failed', headers: bearer(user) })).statusCode
    ).toBe(403);

    const list = await app.inject({
      url: '/api/v1/admin/queue/failed?limit=10',
      headers: bearer(ADMIN),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      data: [{ id: first.id, problemId: 'two-sum', userId: user }],
      nextCursor: null,
    });

    const requeue = (id: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/admin/queue/failed/${id}/requeue`,
        headers: bearer(ADMIN),
      });
    expect((await requeue(first.id)).json()).toEqual({ submissionId: first.id, status: 'queued' });
    expect(first.status).toBe('queued');
    expect((await requeue(first.id)).statusCode).toBe(404); // no longer in the dead-letter list
  });

  it('pages the dead-letter list with a keyset cursor', async () => {
    for (const s of submissions.all()) {
      s.status = 'failed';
      s.judgedAt = new Date(Date.now() - Math.random() * 1000);
    }
    const page1 = (
      await app.inject({ url: '/api/v1/admin/queue/failed?limit=1', headers: bearer(ADMIN) })
    ).json();
    expect(page1.data).toHaveLength(1);
    const page2 = (
      await app.inject({
        url: `/api/v1/admin/queue/failed?limit=1&cursor=${page1.nextCursor}`,
        headers: bearer(ADMIN),
      })
    ).json();
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).not.toBe(page1.data[0].id);
    expect(page2.nextCursor).toBeNull();
    const bad = await app.inject({
      url: '/api/v1/admin/queue/failed?cursor=bm9wZQ',
      headers: bearer(ADMIN),
    });
    expect(bad.statusCode).toBe(400);
  });
});
