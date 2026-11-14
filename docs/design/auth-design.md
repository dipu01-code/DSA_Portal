# Auth design (Person 3)

Day 1 plan, built on Day 3. Code: `server/src/modules/auth`, `server/src/modules/admin`, `ui-core/src/auth`, `desktop/src/token-store.ts`.
(The prompt pack names `/docs/auth-plan` and `/docs/auth-design.md`; they live here because `/docs/design` is Person 3's folder.)

## Tokens

|               | Access token                                                                                | Refresh token                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Format        | JWT HS256, payload `{ sub: userId, iat, exp }` (signed with `JWT_SECRET` by `@fastify/jwt`) | 32 random bytes, base64url (opaque)                                                             |
| Lifetime      | 15 min (`expiresIn: 900` in the login response)                                             | 7 days                                                                                          |
| Server stores | nothing                                                                                     | `sha256(token)` in `sessions.token_hash` (+ user, expiry, IP, user agent)                       |
| Sent as       | `Authorization: Bearer <jwt>`                                                               | Cookie `refresh_token` (`HttpOnly; SameSite=Strict; Path=/api/v1/auth`; `Secure` in production) |

The role is **not** in the token. `authorize(store, 'admin')` reads it from the database on each admin call, so a demotion takes effect immediately (admin calls are rare, so the extra query is cheap).

## Storage per platform

| Platform             | Access token              | Refresh token                                                                                                                                                  |
| -------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web                  | memory only (`ApiClient`) | HttpOnly cookie, handled by the browser; JS never stores it                                                                                                    |
| Desktop (Electron)   | renderer memory           | main process, encrypted with `safeStorage` (Keychain / DPAPI / libsecret) in `userData`; never written in plain text (memory only if the OS has no encryption) |
| Mobile (Expo, Day 6) | memory                    | `expo-secure-store` through the same `SecureStorage` interface                                                                                                 |

Native platforms have no cookie jar: `nativeRefresh` sends `Cookie: refresh_token=<stored>` and saves the rotated value from `Set-Cookie`. Same endpoint, no API change (CR-013 withdrawn).

## Flows

- **Register** `POST /auth/register` → password policy → bcrypt (cost 12, `BCRYPT_COST`) → `201 User`. Duplicate username/email → `409 CONFLICT`.
- **Login** `POST /auth/login` → throttle check → bcrypt compare → new session → `{ accessToken, refreshToken, expiresIn }` + cookie.
- **Refresh with rotation** `POST /auth/refresh` → `consumeSession(sha256(token))` in one atomic `UPDATE … SET revoked_at = now() WHERE revoked_at IS NULL AND expires_at > now()`; on success the next token is issued in the same login family (`sessions.family_id`). A token that was already used → **reuse detected** → that whole family is revoked → 401 (attacker and victim must log in again on that device; the user's other devices stay signed in).
- **Logout** `POST /auth/logout` → delete the session row, clear the cookie → 204.
- **Me** `GET /auth/me` → `User`.
- **Client side** (`ui-core`): any 401 triggers one shared refresh (single flight, so two parallel requests can't trip reuse detection), then the request is replayed once. If the refresh fails, the auth store goes to `anonymous` and the UI shows the login page. On app start `restore()` uses the refresh token to sign in without a password.

## Middleware for Persons 1 and 2

```ts
import { authenticate, authorize } from './modules/auth/hooks';
app.decorate('authenticate', authenticate); // replaces the TEMP stub in app.ts (CR-010)
app.get('/x', { onRequest: app.authenticate }, h); // any signed-in user, req.user.sub = user id
app.post('/y', { onRequest: app.authenticate, preHandler: authorize(authStore, 'admin') }, h); // admins only → 403 FORBIDDEN
```

## Threats and mitigations

| Threat                                    | Mitigation                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Credential stuffing / brute force**     | `LoginThrottle`: 5 failures per IP+email and 20 per IP in 15 min → `429` + `Retry-After`; bcrypt cost 12 makes each guess expensive; password policy (8–72 bytes, letter + digit, not containing username/email). Limit is per process (moves to Redis on Day 7).                    |
| **User enumeration**                      | Same `401 Invalid email or password` for unknown email and wrong password, and the same time (a dummy bcrypt compare when the email is unknown). Register does reveal "already exists" (409), as the spec requires; throttling limits scraping.                                      |
| **Token theft (access)**                  | 15-minute lifetime; kept in memory, not `localStorage`.                                                                                                                                                                                                                              |
| **Token theft (refresh) / refresh reuse** | HttpOnly cookie (web) or OS-encrypted storage (desktop/mobile); only a hash in the database (a DB leak gives no live sessions); rotation on every use; reuse detection revokes the stolen login family (`family_id`). Atomic consume: two concurrent refreshes can't both succeed.   |
| **XSS**                                   | React escapes output; no `dangerouslySetInnerHTML`; refresh token unreadable by JS; desktop CSP `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`. Desktop renderer has no Node (`contextIsolation`, `sandbox`, `nodeIntegration: false`) and only a typed IPC allow-list. |
| **CSRF**                                  | API auth is a bearer header (not sent automatically by browsers). The only cookie is `SameSite=Strict` and scoped to `/api/v1/auth`, so other sites can't trigger refresh/logout with it.                                                                                            |
| **Password DB leak**                      | bcrypt with per-password salt, cost 12. 72-byte cap avoids bcrypt's silent truncation.                                                                                                                                                                                               |
| **Privilege escalation**                  | Role read from the DB per admin request; admin input validated with core's zod `ProblemSchema`, unknown fields rejected (`.strict()`).                                                                                                                                               |
| **Timing on token lookup**                | Refresh tokens are looked up by their SHA-256, so response time doesn't depend on how many characters of a real token match.                                                                                                                                                         |

## Spec vs schema mismatches found (Day 1 item 5)

1. Core `UserRepository` has no email lookup, password hash or sessions → auth has its own `AuthStore` (CR-009).
2. Seed password hash is not a valid bcrypt hash of `password123` → seed users can't log in (CR-012).
3. `StatsRepository.streak` is a number but the spec's `StreakStat` needs three fields → computed in the stats module (CR-011, superseded).
4. `ProblemRepository` has no delete; `findById` ignores `is_published` (CR-015).
5. `sessions` had no revoked/family columns for rotation (CR-014, added in migration 004 on Day 7).
6. Spec lacks `/stats/me/streak`, `difficulties` and the login `429` (CR-016).
