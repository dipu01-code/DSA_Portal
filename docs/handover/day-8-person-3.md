# Day 8 — Person 3: Offline UX, sync status, dark mode and accessibility

## What was built

**Sync outbox (`ui-core/src/sync.ts`), one implementation for all clients.** Person 2's SyncEngine and the `/sync` routes don't exist yet (CR-030), so the clients ship a submission outbox:

- A submit that fails with a network error goes into the outbox instead of failing (`SubmissionState.status = 'queued'`). On desktop, an offline submit is judged locally _and_ queued with its local verdict.
- Status `online | offline | syncing | error`, pending count, queued list (`pending → syncing → synced`, or `conflict` / `rejected` with a message), `syncNow()`, `clearFinished()`.
- Reconnect (or signing in) replays the queue oldest first through `POST /submissions` with the **original Idempotency-Key**, then polls until judged. Single flight (one sync at a time). A 4xx refusal is `rejected` (e.g. problem removed), a 5xx/timeout stays pending with an error, 401 waits for sign-in. Items queued by user A are never sent for user B.
- Conflict: desktop offline verdict ≠ server verdict → "Offline run passed 5/5, the server judged 4/5. The server's result counts."
- Persisted: localStorage (web/desktop), SQLite `kv` table (mobile, `sqliteKv` in `mobile/src/local-store.ts`).
- Shared wording: `syncSummary()` ("Offline · 2 queued", "Syncing 2…") and `describeQueued()` ("Synced · Accepted 2/2").

**Offline browsing.** `withProblemCache` moved from mobile into ui-core and now also covers `problems()`, `topics()` and offline `randomProblem()` (random pick from saved problems). Web uses it with `storageLocalStore(localStorage)`; mobile with expo-sqlite. Web Home and mobile Practice show **"On this device / On this phone"** while offline. Desktop keeps its 40 bundled problems.

**UI**

- Web + desktop: the header badge (● Online / ○ Offline / ↻ Syncing / ! problem) opens a sync panel: explanation, queued list with state and messages, last synced, **Sync now**, **Clear finished**. Esc closes it; changes are announced through a `role=status` live region.
- Problem page: "queued, will be judged when you reconnect" message; desktop shows "judged on this computer, syncs when you reconnect".
- Mobile: `SyncBar` replaces the offline banner (shows when offline, syncing or something is queued, with Sync now); new **Settings** tab with Theme (System/Light/Dark, persisted) and the full sync list.
- Dark/light everywhere from the design tokens; mobile now follows the Settings choice (before: system only).
- Accessibility: focus moves to `<main>` after route changes; skeleton loaders (problem page, leaderboard) with screen-reader status text; reduced motion already disables the pulse; AA contrast covered by the token test.
- Lighthouse (web, login page, mock build): **Performance 95, Accessibility 100, Best practices 96, SEO 100** (SEO was 82: added meta description, inline SVG favicon, `robots.txt`). The 4 best-practice points are the expected 401 from the silent sign-in probe and no socket server in the mock build.

## How to run

```bash
npm test -w ui-core    # 46 (sync outbox: replay, conflict, rejected, 5xx retry, users, single flight, persistence; problem cache)
npm test -w web        # 7  (incl. offline submit → reconnect → "Synced · Accepted 2/2", offline "On this device" list)
npm test -w mobile     # 18 (queued → Settings → Sync now → synced, theme switch, saved list, SQLite kv)
npm run build -w desktop && (cd desktop && npx playwright test)   # Electron: log in → API down → solve offline → API back → synced + judged on the server
```

Manual check of the Day 8 "done when": web (`npm run dev:web` against the real API) → open a problem → DevTools → Network → Offline → Submit → badge "○ Offline · 1 queued" → Online → badge "↻ Syncing 1…" → panel "Synced · Accepted n/n", stats refresh.

## For others

|                                                            |                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `dsa.stores.sync` / `useSync()`                            | `{ online, status, queue, lastError, lastSyncedAt, enqueue, syncNow, clearFinished }` |
| `createDsa({ network })`                                   | new option: a `NetworkStatus` adapter; `settingsStorage` now also persists the outbox |
| `withProblemCache`, `storageLocalStore`                    | exported from ui-core                                                                 |
| CR-030 (Person 2; was CR-023 before the merge with `main`) | SyncEngine shape the UI can switch to; no endpoint, table or event changed            |

## Known issues

1. Not Person 2's SyncEngine (doesn't exist yet, CR-030); only submissions are queued. Hints and solution reveals need the network (desktop: offline engine has them).
2. Web offline cache is one localStorage JSON blob (marked `shortcut:`); fine for a few hundred problems.
3. Web can't judge offline (no sandbox in the browser); "Run tests" still works offline in the Web Worker.
4. A desktop offline guest's queued submissions go to whoever signs in next on that machine.
5. Mobile Settings/outbox were tested with jest-expo only, not re-run on the emulator today.

## Design decisions (viva)

- **Outbox over the existing submit API:** no new endpoint or table, so nothing in the contract changed; the Idempotency-Key makes replay safe after a lost response (at-least-once delivery + idempotent server = effectively once).
- **The server is the source of truth:** offline verdicts are feedback; the server re-judges, and a mismatch is shown as a conflict rather than silently merged. Untrusted clients can't post their own "Accepted".
- **Network failure ≠ server error:** only status 0 queues or falls back to the cache; a 404 or 500 is shown, never hidden behind stale data.
- **One store, three UIs:** the outbox, wording and cache live in ui-core; web, desktop and mobile only add adapters (localStorage / SQLite, navigator.onLine / Electron health poll / NetInfo) and screens.
- **Announce, don't steal focus:** sync changes go to a live region; focus moves only on navigation.
- **Same interface as the future SyncEngine:** the UI reads `status / queue / syncNow`, so swapping the engine underneath is a ui-core change, not a screen change.
