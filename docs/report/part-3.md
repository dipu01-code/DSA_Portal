# Report — Part 3: clients, authentication, statistics, caching and offline UX

_Person 3 of 3. Detailed designs: `docs/design/` (auth-design, stats-design, cache-design, components, wireframes, mobile-editor-decision, release). Tests: `docs/test/`._

## 1. Scope

Person 3 built the three graphical clients (web, Electron desktop, Expo/React Native Android) on one shared library (`/ui-core`), plus three server parts: JWT authentication with roles and admin endpoints, the statistics model and API, and the Redis cache. The CLI and the judging engine (Person 1) and the database, sync storage and DevOps (Person 2) are covered in their parts.

## 2. Client architecture: "one brain, three faces"

```
            ┌──────────────── /ui-core (TypeScript, no UI) ─────────────────┐
            │ typed API client (generated from openapi.yaml)                 │
            │   bearer token · single-flight refresh on 401 · GET retry      │
            │ Zustand stores: auth · problem · submission · stats ·          │
            │   settings · sync (offline outbox)                             │
            │ React hooks · design tokens · Socket.IO client · problem cache │
            │ adapter interfaces: SecureStorage · NetworkStatus · LocalStore │
            └───────▲────────────────────▲──────────────────────▲───────────┘
                    │                    │                      │
   web (React+Vite, Monaco)   desktop (Electron: same      mobile (Expo Router,
   localStorage, navigator    renderer + main process:     SecureStore, NetInfo,
   .onLine, Web Worker "Run"  safeStorage, offline engine  expo-sqlite, native
                              + sandbox utility process)   editor)
```

- **All behaviour lives in ui-core** (stores and the API client have no React or DOM code), so it is tested once and every platform behaves the same. A platform supplies only adapters and screens: web ≈ 1 platform file, mobile ≈ 3.
- **The API client is generated from `docs/openapi.yaml`** (openapi-typescript): a contract change is a compile error in the clients, not a runtime surprise.
- **`DsaApi` is an interface**, so the desktop wraps it (`withOfflineEngine`) and web/mobile wrap it (`withProblemCache`) without the screens knowing.
- **Desktop = the web build + a hardened shell:** `contextIsolation`, no `nodeIntegration`, sandboxed renderer, an IPC allow-list, a strict CSP on a custom `app://` protocol; the renderer never sees Node, files or the refresh token.
- **Mobile editor:** a native `TextInput` with a symbol key bar instead of Monaco in a WebView: reliable typing, selection and screen-reader support on phones beat syntax highlighting for short exercises.
- **Design tokens** (one JSON) become CSS variables on web and style objects on React Native; a unit test checks WCAG AA contrast for every text/background pair in light and dark.

## 3. Authentication

|                  | Choice                                                                                                      | Why                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Access token     | JWT HS256, 15 min, `{ sub }` only, in memory                                                                | short-lived, nothing to steal from storage; role read from the DB per admin call, so a demotion is immediate |
| Refresh token    | 32 random bytes, 7 days, **stored hashed** (sha256) in `sessions`                                           | a database leak doesn't hand out sessions                                                                    |
| Rotation         | every refresh consumes the token in one atomic `UPDATE` and issues the next in the same **family**          | a replayed (stolen) token is detected and revokes only that login family                                     |
| Web storage      | `HttpOnly; SameSite=Strict; Secure; Path=/api/v1/auth` cookie                                               | XSS can't read it; CSRF can't send it cross-site                                                             |
| Desktop / mobile | Electron `safeStorage` (Keychain/DPAPI/libsecret) / `expo-secure-store`                                     | OS-encrypted; same endpoint via a `Cookie` header                                                            |
| Passwords        | bcrypt cost 12; 8–72 chars, letter + digit, not containing username/email                                   | 72 = bcrypt's input limit                                                                                    |
| Attacks          | login throttling, constant-time compare with a dummy hash for unknown emails, one message for every failure | credential stuffing, user enumeration                                                                        |
| Client           | one shared refresh in flight; the failed request is replayed once                                           | parallel 401s can't trip reuse detection                                                                     |

Roles: `user`, `admin`; `authenticate` and `authorize(role)` Fastify hooks are used by all three people's routes. Admin endpoints create/update/delete problems and add test cases, validated with core's zod schema. Open item: throttling is per process (should move to Redis, bug 13).

## 4. Statistics model

Three designs were compared (compute on read, maintained counters, materialized view; table in `docs/design/stats-design.md`). **Chosen: maintained counters**: one `user_problem_stats` row per (user, problem), upserted by `updateStatsOnSubmission(tx, submission)` **in the same transaction** that stores the judged result. Reads are constant-time as history grows, and stats can never disagree with submissions; `ON CONFLICT DO UPDATE` makes concurrent submissions safe (tested with 10 concurrent transactions). Streak rules: a day counts when a problem is solved for the first time that day, in UTC (same for every device; the cost is a midnight that is not local). API: `GET /stats/me`, `/stats/me/topics`, `/stats/me/streak`.

## 5. Caching (Redis)

Cache-aside for public data only: problem lists (300 s), problem detail (600 s), leaderboard (30 s), daily challenge (300 s). **Generation keys** invalidate a whole family with one `INCR` (admin edits; the worker bumps the leaderboard after each judged submission). **Stampede protection** at two levels: single flight per process plus a short Redis `SET NX` lock across processes, and 0–10 % TTL jitter. **PostgreSQL stays the truth:** if Redis is down every call passes through (availability over consistency); the worst case is data up to one TTL old, which is why user-private data (stats, submissions) is never cached. Hit/miss/error counters are rendered for Prometheus. Since the merge with `main` the cache wraps Person 1's leaderboard and daily stores (`CachedLeaderboardStore`, `CachedDailyChallengeStore`); wiring them and `/metrics` into Person 1's `index.ts` is CR-032.

## 6. Offline UX

| Client  | Offline reading                       | Offline judging                                                                                         | Offline submit                |
| ------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Desktop | all 40 problems bundled               | yes: core's sandbox in an Electron utility process (the app's own binary runs as Node, no Node install) | judged locally **and** queued |
| Web     | problems opened before (localStorage) | "Run" only (Web Worker with a time limit)                                                               | queued                        |
| Android | problems opened before (SQLite)       | no (server only)                                                                                        | queued                        |

**Outbox** (`ui-core/src/sync.ts`). Person 2's SyncEngine wasn't available, so the clients queue submissions on the device and replay them through the existing `POST /submissions` with the **original Idempotency-Key** when the network returns (on reconnect, on sign-in, or "Sync now"). At-least-once delivery plus an idempotent server gives effectively-once: lost responses, flaky Wi-Fi and two tabs replaying the same queue all produce one submission (tested). The server re-judges, and its verdict counts; if a desktop offline verdict differs, the user sees a **conflict** with both results. A 4xx refusal is shown as "Not accepted", a 5xx leaves the item pending, and a session that ended while offline keeps the queue and asks the user to sign in. The same interface (`status`, `queue`, `syncNow`) is what the UI will read from Person 2's SyncEngine (CR-030).

**Status at every step:** header badge / mobile bar: ● Online, ○ Offline · n queued, ↻ Syncing n…, ! Sync problem; a panel lists each item (waiting → sending and judging → Synced · Accepted 5/5); the problem page follows its own queued submission to the verdict. Changes are announced to screen readers without moving focus.

**Accessibility:** WCAG AA contrast (unit-tested), full keyboard use (skip link, focus moved to the page on navigation, Esc closes panels, Ctrl/Cmd+Enter, Ctrl/Cmd+K), labelled controls, live regions, reduced motion, 44–48 pt touch targets. Lighthouse (web): Performance 95, Accessibility 100, Best practices 96, SEO 100.

## 7. Testing and quality

| Layer                                                                                                                            | Count                  | Tool                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| ui-core: client, stores, outbox incl. edge cases, cache, hooks                                                                   | 54                     | Vitest + MSW                               |
| web components and screens                                                                                                       | 15                     | React Testing Library                      |
| mobile screens on the real stores, SQLite                                                                                        | 18                     | jest-expo + RNTL, node:sqlite              |
| web e2e: register → login → solve → stats; offline → reconnect → synced                                                          | 2                      | Playwright (Chrome) on the real server app |
| desktop e2e: launch → login → offline judging → reconnect → synced (dev build **and** the packaged .app)                         | 1                      | Playwright Electron                        |
| server auth/admin/stats/cache                                                                                                    | in the root Jest suite | Jest + PostgreSQL + Redis                  |
| Bug list: 15 found on Day 9, 12 fixed with regression tests (`docs/test/bugs.md`), including two privacy bugs on shared devices. |

## 8. Delivery

Web: static `web/dist` behind a reverse proxy on the API's origin. Desktop: electron-builder (`.dmg` built and tested; NSIS and AppImage configured), unsigned with signing notes. Android: `expo prebuild` + Gradle `assembleRelease` APK. Exact steps: `docs/design/release.md`.

## 9. Limitations and next steps

1. Replace the outbox with Person 2's SyncEngine when it exists (CR-030); sync settings and drafts too.
2. Login throttling in Redis (bug 13); ask before syncing an offline guest's work (bug 14).
3. Code signing and notarization; a release keystore for Android.
4. Average time per problem needs a `started_at` per attempt (not recorded today).
5. Push notifications (daily challenge, streak reminder) were dropped for time.
