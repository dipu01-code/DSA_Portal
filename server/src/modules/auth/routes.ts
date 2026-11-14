import { createHash, randomBytes } from 'crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { HttpError } from '../../lib/http';
import { passwordProblem } from './password-policy';
import { DuplicateUserError, type ApiUser, type AuthStore } from './store';
import { LoginThrottle } from './throttle';

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 7 * 24 * 60 * 60;
const BCRYPT_COST = Number(process.env.BCRYPT_COST) || 12;
const COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth'; // the cookie is only sent to refresh/logout
// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-1', BCRYPT_COST);

const RegisterBody = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email().max(254),
  password: z.string(),
});
const LoginBody = z.object({ email: z.string().max(254), password: z.string().max(1024) });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const unauthorized = (msg: string) => new HttpError(401, 'UNAUTHORIZED', msg);
const toApiUser = (u: ApiUser) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
});

/**
 * Browsers send the HttpOnly cookie themselves. Native clients (Electron main, Expo) have no
 * cookie jar, so they put the same `refresh_token=...` in a Cookie header; the server can't tell apart.
 */
function readRefreshCookie(req: FastifyRequest): string | undefined {
  return req.headers.cookie?.match(/(?:^|;\s*)refresh_token=([^;]+)/)?.[1];
}

function setRefreshCookie(reply: FastifyReply, value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  reply.header(
    'set-cookie',
    `${COOKIE}=${value}; Max-Age=${maxAge}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict${secure}`
  );
}

export interface AuthRouteOptions {
  auth: AuthStore;
  throttle?: LoginThrottle;
}

export const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (
  app,
  { auth, throttle = new LoginThrottle() }
) => {
  const signAccess = (userId: string) => app.jwt.sign({ sub: userId }, { expiresIn: ACCESS_TTL_S });

  async function startSession(
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    familyId?: string
  ) {
    const refreshToken = randomBytes(32).toString('base64url');
    await auth.createSession({
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(reply, refreshToken, REFRESH_TTL_S);
    return refreshToken;
  }

  app.post('/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const email = body.email.toLowerCase();
    const problem = passwordProblem(body.password, { username: body.username, email });
    if (problem) throw new HttpError(400, 'VALIDATION_ERROR', problem);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    try {
      const user = await auth.createUser({ username: body.username, email, passwordHash });
      return reply.code(201).send(toApiUser(user));
    } catch (err) {
      if (err instanceof DuplicateUserError) {
        throw new HttpError(409, 'CONFLICT', 'Username or email already exists');
      }
      throw err;
    }
  });

  app.post('/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const email = body.email.toLowerCase();
    const wait = throttle.retryAfter(req.ip, email);
    if (wait > 0) {
      reply.header('retry-after', String(wait));
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many failed logins, try again later');
    }
    const user = await auth.findByEmail(email);
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      throttle.fail(req.ip, email);
      throw unauthorized('Invalid email or password');
    }
    throttle.succeed(req.ip, email);
    const refreshToken = await startSession(req, reply, user.id);
    return { accessToken: signAccess(user.id), refreshToken, expiresIn: ACCESS_TTL_S };
  });

  // Rotation: every refresh uses up the old token and sets a new one in the same login family.
  // Presenting a used token again means two parties hold it (theft), so that family is revoked;
  // the user's other devices (other families) stay signed in.
  app.post('/auth/refresh', async (req, reply) => {
    const token = readRefreshCookie(req);
    if (!token) throw unauthorized('Missing refresh token');
    const result = await auth.consumeSession(sha256(token));
    if (result.status === 'reused') {
      req.log.warn(
        { userId: result.userId },
        'refresh token reuse detected; session family revoked'
      );
    }
    if (result.status !== 'ok') {
      setRefreshCookie(reply, '', 0);
      throw unauthorized('Refresh token is invalid or expired');
    }
    await startSession(req, reply, result.userId, result.familyId);
    return { accessToken: signAccess(result.userId) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = readRefreshCookie(req);
    if (token) await auth.deleteSession(sha256(token));
    setRefreshCookie(reply, '', 0);
    return reply.code(204).send();
  });

  app.get('/auth/me', { onRequest: app.authenticate }, async (req) => {
    const user = await auth.findById(req.user.sub);
    if (!user) throw unauthorized('User no longer exists');
    return toApiUser(user);
  });
};
