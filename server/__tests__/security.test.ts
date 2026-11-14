import { createHash, randomUUID } from 'crypto';
import type { AuditEntry, AuditRepository } from '@dsa-portal/core';
import { buildApp, type AppOptions } from '../src/app';
import { RateLimiter } from '../src/lib/rate-limit';

const CODE = 'function solve() { return [0, 1]; }';

async function setup(opts: AppOptions = {}) {
  const app = buildApp({ logger: false, ...opts });
  await app.ready();
  const token = () => `Bearer ${app.jwt.sign({ sub: randomUUID() })}`;
  const submit = (
    authorization: string,
    extra: { headers?: Record<string, string>; ip?: string; code?: string } = {}
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/submissions',
      remoteAddress: extra.ip,
      headers: { authorization, ...extra.headers },
      payload: { problemId: 'two-sum', code: extra.code ?? CODE },
    });
  return { app, token, submit };
}

describe('RateLimiter', () => {
  it('allows `limit` hits per window, then reports the seconds left, then resets', () => {
    const rl = new RateLimiter(2, 60_000);
    expect([rl.hit('a', 0), rl.hit('a', 1), rl.hit('a', 2)]).toEqual([0, 0, 60]);
    expect(rl.hit('b', 2)).toBe(0); // keys are independent
    expect(rl.hit('a', 30_000)).toBe(30);
    expect(rl.hit('a', 60_000)).toBe(0); // new window
  });
});

describe('rate limits (429 RATE_LIMITED)', () => {
  it('limits requests per IP, with Retry-After and the standard error body', async () => {
    const { app } = await setup({ rateLimit: { perIp: 3 } });
    const hit = (ip: string) =>
      app.inject({ method: 'GET', url: '/api/v1/health', remoteAddress: ip });
    for (let i = 0; i < 3; i++) expect((await hit('10.0.0.1')).statusCode).toBe(200);
    const res = await hit('10.0.0.1');
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({
      error: 'RATE_LIMITED',
      statusCode: 429,
      path: '/api/v1/health',
    });
    expect((await hit('10.0.0.2')).statusCode).toBe(200); // another IP is unaffected
    await app.close();
  });

  it('limits one user even when they spread requests over many IPs', async () => {
    const { app, token } = await setup({ rateLimit: { perUser: 2 } });
    const auth = token();
    const me = (ip: string, authorization = auth) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/submissions',
        remoteAddress: ip,
        headers: { authorization },
      });
    expect((await me('10.0.1.1')).statusCode).toBe(200);
    expect((await me('10.0.1.2')).statusCode).toBe(200);
    const res = await me('10.0.1.3');
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/user/);
    expect((await me('10.0.1.3', token())).statusCode).toBe(200); // another user is unaffected
    await app.close();
  });
});

describe('execution quotas (429 QUOTA_EXCEEDED)', () => {
  it('caps submissions per minute; an idempotent replay still answers and uses no quota', async () => {
    const { app, token, submit } = await setup({ quota: { perMinute: 2 } });
    const auth = token();
    const first = await submit(auth, { headers: { 'idempotency-key': 'k1' } });
    expect(first.statusCode).toBe(202);
    expect((await submit(auth)).statusCode).toBe(202);

    const res = await submit(auth);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({
      error: 'QUOTA_EXCEEDED',
      message: expect.stringMatching(/per minute/),
    });
    const retry = Number(res.headers['retry-after']);
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);

    const replay = await submit(auth, { headers: { 'idempotency-key': 'k1' } });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().submissionId).toBe(first.json().submissionId);
    expect((await submit(token())).statusCode).toBe(202); // quotas are per user
    await app.close();
  });

  it('caps submissions per day, with Retry-After up to 24 h', async () => {
    const { app, token, submit } = await setup({ quota: { perMinute: 100, perDay: 1 } });
    const auth = token();
    expect((await submit(auth)).statusCode).toBe(202);
    const res = await submit(auth);
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/per day/);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(86_000);
    await app.close();
  });
});

describe('request hygiene', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => void (t = await setup({ corsOrigins: ['https://app.example.com'] })));
  afterAll(() => t.app.close());
  const app = { inject: (...a: Parameters<typeof t.app.inject>) => t.app.inject(...a) };
  const token = () => t.token();
  const submit = (...a: Parameters<typeof t.submit>) => t.submit(...a);

  it('sends helmet-style security headers on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': expect.stringContaining("default-src 'none'"),
      'strict-transport-security': expect.stringContaining('max-age='),
    });
  });

  it('answers CORS only for allow-listed origins', async () => {
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/api/v1/problems/random',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
    expect(
      (await preflight('https://app.example.com')).headers['access-control-allow-origin']
    ).toBe('https://app.example.com');
    expect(
      (await preflight('https://evil.example.net')).headers['access-control-allow-origin']
    ).toBeUndefined();
  });

  it('refuses bodies over the size limit with 413', async () => {
    const res = await submit(token(), { code: 'x'.repeat(600 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects code with NUL characters as a validation error, not a 500', async () => {
    const res = await submit(token(), { code: 'function solve() {}\u0000' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'VALIDATION_ERROR',
      message: expect.stringMatching(/NUL/),
    });
  });
});

describe('audit log', () => {
  it('records who submitted what, when and from which IP', async () => {
    const entries: Omit<AuditEntry, 'id' | 'createdAt'>[] = [];
    const audit: AuditRepository = {
      log: async (e) => void entries.push(e),
      findByEntity: async () => [],
      findByActor: async () => [],
    };
    const { app, submit } = await setup({ audit });
    const userId = randomUUID();
    const res = await submit(`Bearer ${app.jwt.sign({ sub: userId })}`, { ip: '203.0.113.9' });
    expect(res.statusCode).toBe(202);
    expect(entries).toEqual([
      {
        actorId: userId,
        action: 'submission.create',
        entityType: 'submission',
        entityId: res.json().submissionId,
        newValue: {
          problemId: 'two-sum',
          codeSha256: createHash('sha256').update(CODE).digest('hex'),
          codeLength: CODE.length,
        },
        ipAddress: '203.0.113.9',
      },
    ]);
    await app.close();
  });

  it('still accepts the submission when the audit write fails', async () => {
    const audit = {
      log: async () => Promise.reject(new Error('db down')),
    } as unknown as AuditRepository;
    const { app, token, submit } = await setup({ audit });
    expect((await submit(token())).statusCode).toBe(202);
    await app.close();
  });
});

describe('API docs (Day 10)', () => {
  it('serves Redoc at /docs with a CSP that allows only its pinned script, and the spec it renders', async () => {
    const { app } = await setup();
    const page = await app.inject({ method: 'GET', url: '/docs' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<redoc spec-url="/docs/openapi.yaml">');
    expect(page.headers['content-security-policy']).toMatch(/script-src https:\/\/cdn\.redoc\.ly;/);
    expect(page.headers['x-frame-options']).toBe('DENY');

    const spec = await app.inject({ method: 'GET', url: '/docs/openapi.yaml' });
    expect(spec.statusCode).toBe(200);
    expect(spec.headers['content-type']).toMatch(/yaml/);
    expect(spec.body).toMatch(/^openapi: 3/);
    // Everything else keeps the strict CSP.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/health' })).headers[
        'content-security-policy'
      ]
    ).toBe("default-src 'none'; frame-ancestors 'none'");
    await app.close();
  });
});
