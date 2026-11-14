import { randomUUID } from 'crypto';
import type { User } from '@dsa-portal/core';
import { pool } from '../../db/pool';

export type ApiUser = User & { createdAt: Date };

export interface NewSession {
  userId: string;
  /** Login family the token belongs to; omitted on login (a new family starts). */
  familyId?: string;
  tokenHash: string;
  expiresAt: Date;
  ip?: string;
  userAgent?: string;
}

/**
 * Result of presenting a refresh token:
 * - ok: it was live and is now used up (the caller issues the next token in the same family),
 * - reused: it was already used, so two parties hold it (theft); its whole family is revoked,
 * - invalid: unknown or expired.
 */
export type ConsumeResult =
  | { status: 'ok'; userId: string; familyId: string }
  | { status: 'reused'; userId: string }
  | { status: 'invalid' };

/**
 * What the auth routes need from storage. Core's UserRepository has no email lookup,
 * password hash or sessions, so auth owns this small interface (see CR-009).
 */
export interface AuthStore {
  /** Throws `DuplicateUserError` if username or email is taken. */
  createUser(u: { username: string; email: string; passwordHash: string }): Promise<ApiUser>;
  findByEmail(email: string): Promise<(ApiUser & { passwordHash: string }) | null>;
  findById(id: string): Promise<ApiUser | null>;
  /** Refresh-token sessions keyed by sha256(token), never the raw token. */
  createSession(s: NewSession): Promise<void>;
  /** Atomically uses up a refresh token, so two concurrent refreshes can't both succeed. */
  consumeSession(tokenHash: string): Promise<ConsumeResult>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class DuplicateUserError extends Error {}

/** For tests and running the API without a database. */
export class InMemoryAuthStore implements AuthStore {
  private users = new Map<string, ApiUser & { passwordHash: string }>();
  private sessions = new Map<
    string,
    { userId: string; familyId: string; expiresAt: Date; revoked: boolean }
  >();

  async createUser(u: { username: string; email: string; passwordHash: string }) {
    for (const x of this.users.values()) {
      if (x.username === u.username || x.email === u.email) throw new DuplicateUserError();
    }
    const user = { id: randomUUID(), role: 'user' as const, createdAt: new Date(), ...u };
    this.users.set(user.id, user);
    return strip(user);
  }
  async findByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    const u = this.users.get(id);
    return u ? strip(u) : null;
  }
  /** Test helper: the Postgres store gets admins from the seed. */
  setRole(id: string, role: 'user' | 'admin') {
    const u = this.users.get(id);
    if (u) u.role = role;
  }
  async createSession(s: NewSession) {
    this.sessions.set(s.tokenHash, {
      userId: s.userId,
      familyId: s.familyId ?? randomUUID(),
      expiresAt: s.expiresAt,
      revoked: false,
    });
  }
  async consumeSession(tokenHash: string): Promise<ConsumeResult> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt.getTime() <= Date.now()) return { status: 'invalid' };
    if (s.revoked) {
      for (const v of this.sessions.values()) if (v.familyId === s.familyId) v.revoked = true;
      return { status: 'reused', userId: s.userId };
    }
    s.revoked = true;
    return { status: 'ok', userId: s.userId, familyId: s.familyId };
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

const strip = ({ passwordHash: _, ...u }: ApiUser & { passwordHash: string }): ApiUser => u;

const USER_COLS = 'id, username, email, role, created_at AS "createdAt"';

/** Uses the `users` and `sessions` tables (001_initial_schema + 006_session_families). */
export class PostgresAuthStore implements AuthStore {
  async createUser(u: { username: string; email: string; passwordHash: string }) {
    try {
      const res = await pool.query<ApiUser>(
        `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLS}`,
        [u.username, u.email, u.passwordHash]
      );
      return res.rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new DuplicateUserError(); // unique_violation
      throw err;
    }
  }
  async findByEmail(email: string) {
    const res = await pool.query<ApiUser & { passwordHash: string }>(
      `SELECT ${USER_COLS}, password_hash AS "passwordHash" FROM users WHERE email = $1`,
      [email]
    );
    return res.rows[0] ?? null;
  }
  async findById(id: string) {
    const res = await pool.query<ApiUser>(`SELECT ${USER_COLS} FROM users WHERE id = $1::uuid`, [
      id,
    ]);
    return res.rows[0] ?? null;
  }
  async createSession(s: NewSession) {
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, family_id)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::uuid, gen_random_uuid()))`,
      [s.userId, s.tokenHash, s.expiresAt, s.ip ?? null, s.userAgent ?? null, s.familyId ?? null]
    );
  }
  async consumeSession(tokenHash: string): Promise<ConsumeResult> {
    // The row lock of this UPDATE makes concurrent refreshes with one token succeed at most once.
    const used = await pool.query<{ userId: string; familyId: string }>(
      `UPDATE sessions SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
       RETURNING user_id AS "userId", family_id AS "familyId"`,
      [tokenHash]
    );
    if (used.rows[0]) return { status: 'ok', ...used.rows[0] };
    const reused = await pool.query<{ userId: string; familyId: string }>(
      `SELECT user_id AS "userId", family_id AS "familyId" FROM sessions
       WHERE token_hash = $1 AND revoked_at IS NOT NULL AND expires_at > now()`,
      [tokenHash]
    );
    if (!reused.rows[0]) return { status: 'invalid' };
    await pool.query(
      'UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
      [reused.rows[0].familyId]
    );
    return { status: 'reused', userId: reused.rows[0].userId };
  }
  async deleteSession(tokenHash: string) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }
}
