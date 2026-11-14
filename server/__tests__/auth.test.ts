import { assertMatchesSpec, buildPerson3App, bearer, cookieOf } from './helpers/person3-app';
import { InMemoryAuthStore } from '../src/modules/auth/store';
import { LoginThrottle } from '../src/modules/auth/throttle';
import { passwordProblem } from '../src/modules/auth/password-policy';

const alice = { username: 'alice', email: 'Alice@Example.com', password: 'horse-battery-42' };

describe('auth API', () => {
  const auth = new InMemoryAuthStore();
  const { app, call } = buildPerson3App({ auth, throttle: new LoginThrottle(3, 100) });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  const login = (email = alice.email, password = alice.password) =>
    call('POST', '/auth/login', { payload: { email, password } });
  const refresh = (cookie?: string) =>
    call('POST', '/auth/refresh', { headers: cookie ? { cookie } : {} });

  it('registers a user without leaking the password hash', async () => {
    const res = await call('POST', '/auth/register', { payload: alice });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
    });
    expect(res.body).not.toMatch(/password/i);
  });

  it('rejects duplicates (409), invalid input and weak passwords (400)', async () => {
    expect(
      (await call('POST', '/auth/register', { payload: { ...alice, username: 'alice2' } }))
        .statusCode
    ).toBe(409);
    expect(
      (await call('POST', '/auth/register', { payload: { ...alice, email: 'x@y.io' } })).statusCode
    ).toBe(409);
    const bad = await call('POST', '/auth/register', {
      payload: { username: 'ab', email: 'nope', password: 'x' },
    });
    expect(bad.json()).toMatchObject({ statusCode: 400, error: 'VALIDATION_ERROR' });
    const weak = await call('POST', '/auth/register', {
      payload: { username: 'bob', email: 'bob@x.io', password: 'onlyletters' },
    });
    expect(weak.json().message).toMatch(/letter and a digit/);
  });

  it('logs in (email is case-insensitive) and sets an HttpOnly refresh cookie', async () => {
    const res = await login('alice@EXAMPLE.com');
    expect(res.json()).toMatchObject({ expiresIn: 900 });
    expect(String(res.headers['set-cookie'])).toMatch(
      /^refresh_token=[^;]+; Max-Age=604800; Path=\/api\/v1\/auth; HttpOnly; SameSite=Strict/
    );
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await login(alice.email, 'wrong-pass-1');
    const unknown = await login('nobody@example.com');
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it('GET /auth/me needs a valid access token', async () => {
    const me = await call('GET', '/auth/me', {
      headers: bearer((await login()).json().accessToken),
    });
    expect(me.json()).toMatchObject({ username: 'alice' });
    expect((await call('GET', '/auth/me')).statusCode).toBe(401);
    expect((await call('GET', '/auth/me', { headers: bearer('junk') })).statusCode).toBe(401);
  });

  it('rotates the refresh token on every refresh', async () => {
    const first = cookieOf(await login());
    const r1 = await refresh(first);
    expect(r1.statusCode).toBe(200);
    const second = cookieOf(r1);
    expect(second).not.toBe(first);
    expect(
      (await call('GET', '/auth/me', { headers: bearer(r1.json().accessToken) })).statusCode
    ).toBe(200);
    expect((await refresh(second)).statusCode).toBe(200);
  });

  it('detects reuse of a rotated token and revokes that login family only (CR-014)', async () => {
    const stolen = cookieOf(await login());
    const otherDevice = cookieOf(await login()); // a separate login = a separate family
    const legit = cookieOf(await refresh(stolen));
    const replay = await refresh(stolen); // attacker replays the old token
    expect(replay.statusCode).toBe(401);
    expect(String(replay.headers['set-cookie'])).toMatch(/^refresh_token=; Max-Age=0/);
    expect((await refresh(legit)).statusCode).toBe(401); // the whole stolen family is dead
    expect((await refresh(otherDevice)).statusCode).toBe(200); // other devices stay signed in
  });

  it('only one of two concurrent refreshes with the same token wins', async () => {
    const cookie = cookieOf(await login());
    const codes = (await Promise.all([refresh(cookie), refresh(cookie)]))
      .map((r) => r.statusCode)
      .sort();
    expect(codes).toEqual([200, 401]);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const cookie = cookieOf(await login());
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie },
    });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/^refresh_token=; Max-Age=0/);
    expect((await refresh(cookie)).statusCode).toBe(401);
    expect((await refresh()).statusCode).toBe(401);
    expect((await refresh('refresh_token=forged')).statusCode).toBe(401);
  });

  it('throttles repeated failed logins with 429 + Retry-After, even for the right password', async () => {
    await call('POST', '/auth/register', {
      payload: { username: 'carol', email: 'carol@x.io', password: 'carol-pass-77' },
    });
    for (let i = 0; i < 3; i++) {
      expect((await login('carol@x.io', 'bad-guess-1')).statusCode).toBe(401);
    }
    const blocked = await login('carol@x.io', 'carol-pass-77');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await login()).statusCode).toBe(200); // other accounts from the same IP still work
  });
});

it('the spec check itself rejects a wrong body', () => {
  expect(() => assertMatchesSpec('post', '/api/v1/auth/login', 200, { accessToken: 1 })).toThrow(
    /refreshToken|string/
  );
  expect(() => assertMatchesSpec('post', '/api/v1/auth/login', 401, { error: 'x' })).toThrow();
});

describe('LoginThrottle', () => {
  it('opens again after the window', () => {
    const t = new LoginThrottle(2, 10, 1000);
    t.fail('ip', 'a', 0);
    t.fail('ip', 'a', 100);
    expect(t.retryAfter('ip', 'a', 200)).toBe(1);
    expect(t.retryAfter('ip', 'a', 1001)).toBe(0);
  });
  it('limits one IP across many accounts', () => {
    const t = new LoginThrottle(5, 3, 1000);
    ['a', 'b', 'c'].forEach((e) => t.fail('ip', e, 0));
    expect(t.retryAfter('ip', 'd', 10)).toBeGreaterThan(0);
    expect(t.retryAfter('other-ip', 'd', 10)).toBe(0);
  });
});

describe('password policy', () => {
  const u = { username: 'alice', email: 'alice.smith@x.io' };
  it.each([
    ['short1', /at least 8/],
    ['a1'.repeat(37), /72 bytes/],
    ['12345678', /letter and a digit/],
    ['Alice-2024', /username or email/],
    ['alice.smith9', /username or email/],
  ])('rejects %s', (pw, msg) => expect(passwordProblem(pw, u)).toMatch(msg));
  it('accepts a reasonable password', () => expect(passwordProblem('blue-kettle-9', u)).toBeNull());
});

describe('admin API', () => {
  const auth = new InMemoryAuthStore();
  const { app, call, problems } = buildPerson3App({ auth });
  let admin: Record<string, string>;
  let user: Record<string, string>;
  const newProblem = {
    title: 'Sum Of Two',
    topic: 'Arrays',
    difficulty: 'Easy',
    description: 'Return a + b.',
    starterCode: 'function solve({ a, b }) {}',
    testCases: [{ input: '{"a":1,"b":2}', expected: '3' }],
    hints: ['Use +'],
    solution: 'function solve({ a, b }) { return a + b; }',
  };

  beforeAll(async () => {
    await app.ready();
    const mk = async (username: string) => {
      const reg = await call('POST', '/auth/register', {
        payload: { username, email: `${username}@x.io`, password: 'pass-word-12' },
      });
      return {
        id: reg.json().id as string,
        headers: bearer(
          (
            await call('POST', '/auth/login', {
              payload: { email: `${username}@x.io`, password: 'pass-word-12' },
            })
          ).json().accessToken
        ),
      };
    };
    const a = await mk('admin1');
    auth.setRole(a.id, 'admin');
    admin = a.headers;
    user = (await mk('user1')).headers;
  });
  afterAll(() => app.close());

  it('needs a token (401) and the admin role (403)', async () => {
    expect((await call('POST', '/admin/problems', { payload: newProblem })).statusCode).toBe(401);
    const res = await call('POST', '/admin/problems', { payload: newProblem, headers: user });
    expect(res.json()).toMatchObject({ statusCode: 403, error: 'FORBIDDEN' });
  });

  it('creates a problem with a slug id and rejects a duplicate', async () => {
    const res = await call('POST', '/admin/problems', { payload: newProblem, headers: admin });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: 'sum-of-two',
      hints: ['Use +'],
      testCases: [{ input: '{"a":1,"b":2}', expected: '3' }],
    });
    expect((await problems.findById('sum-of-two'))?.testCases[0]).toEqual({
      input: { a: 1, b: 2 },
      expected: 3,
    });
    expect(
      (await call('POST', '/admin/problems', { payload: newProblem, headers: admin })).statusCode
    ).toBe(409);
  });

  it('validates with the core schema (bad topic, empty test cases, non-JSON test case, unknown field)', async () => {
    for (const payload of [
      { ...newProblem, title: 'X1', topic: 'Cooking' },
      { ...newProblem, title: 'X2', testCases: [] },
      { ...newProblem, title: 'X3', testCases: [{ input: 'not json', expected: '1' }] },
      { ...newProblem, title: 'X4', extra: true },
    ]) {
      const res = await call('POST', '/admin/problems', { payload, headers: admin });
      expect([res.statusCode, res.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    }
  });

  it('updates fields, keeps the id, 404s on unknown ids', async () => {
    const res = await call('PUT', '/admin/problems', {
      payload: { id: 'sum-of-two', title: 'Add Two', hints: ['a', 'b'] },
      headers: admin,
    });
    expect(res.json()).toMatchObject({
      id: 'sum-of-two',
      title: 'Add Two',
      hints: ['a', 'b'],
      difficulty: 'Easy',
    });
    expect(
      (
        await call('PUT', '/admin/problems', {
          payload: { id: 'nope', title: 'x' },
          headers: admin,
        })
      ).statusCode
    ).toBe(404);
  });

  it('adds test cases', async () => {
    const res = await call('POST', '/admin/problems/{id}/test-cases', {
      url: '/api/v1/admin/problems/sum-of-two/test-cases',
      payload: { testCases: [{ input: '{"a":-1,"b":1}', expected: '0' }] },
      headers: admin,
    });
    expect(res.json().testCases).toHaveLength(2);
    expect((await problems.findById('sum-of-two'))?.testCases[1]).toEqual({
      input: { a: -1, b: 1 },
      expected: 0,
    });
  });

  it('deletes (204) and 404s on unknown ids', async () => {
    expect(
      (await call('DELETE', '/admin/problems', { query: { id: 'sum-of-two' }, headers: admin }))
        .statusCode
    ).toBe(204);
    expect(await problems.findById('sum-of-two')).toBeNull();
    expect(
      (await call('DELETE', '/admin/problems', { query: { id: 'nope' }, headers: admin }))
        .statusCode
    ).toBe(404);
  });
});
