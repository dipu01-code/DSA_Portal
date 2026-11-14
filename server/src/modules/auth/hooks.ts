import type { FastifyRequest } from 'fastify';
import { HttpError } from '../../lib/http';
import type { AuthStore } from './store';

/**
 * Verifies the bearer access token and sets `req.user.sub` (the user id).
 * Drop-in replacement for the TEMP stub in app.ts: `app.decorate('authenticate', authenticate)`.
 */
export async function authenticate(req: FastifyRequest) {
  try {
    await req.jwtVerify();
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid access token');
  }
  if (typeof req.user?.sub !== 'string' || !req.user.sub) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Token has no subject');
  }
}

/**
 * preHandler that requires a role, e.g. `{ onRequest: app.authenticate, preHandler: authorize(store, 'admin') }`.
 * The role is read from the database, not the token, so a demotion takes effect at once.
 */
export const authorize =
  (store: AuthStore, role: 'user' | 'admin') => async (req: FastifyRequest) => {
    const user = await store.findById(req.user.sub);
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'User no longer exists');
    if (role === 'admin' && user.role !== 'admin') {
      throw new HttpError(403, 'FORBIDDEN', 'Admin role required');
    }
  };
