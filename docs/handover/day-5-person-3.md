# Day 5 — Person 3: Electron desktop app with offline mode

## What was built (`/desktop`)

- **Main** (`src/main.ts`): serves the web build on `app://dsa` with a strict CSP; window with `contextIsolation`, `sandbox`, `nodeIntegration: false`; navigation and new windows blocked; all permission requests denied; IPC **allow-list** (`src/ipc-channels.ts`) with sender check (only `app://dsa`) and argument validation.
- **Preload** (`src/preload.ts`): exposes only the typed `window.dsaDesktop` bridge (`DesktopBridge` in `/ui-core`).
- **Tokens:** refresh token encrypted with `safeStorage` in `userData` (`src/token-store.ts`); main refreshes/logs out with it; the page only gets access tokens.
- **Online:** the normal API. **Offline:** `/core` picks problems from the 40 bundled seed problems, gives hints, and judges with core's sandbox inside an Electron **utility process** (`src/sandbox-worker.ts`); local progress in `offline-progress.json`.
- **Network detection** (`src/network.ts`): online = OS reports a network **and** `GET /api/v1/health` answers; checked every 5 s; the UI switches automatically, and "Practise offline" works without signing in.
- **Native menu + shortcuts:** Run (Cmd/Ctrl+Enter), Submit (Cmd/Ctrl+Shift+Enter), Switch topic (Cmd/Ctrl+K).
- **electron-builder config** (`package.json → build`: dmg / nsis / AppImage; installers on Day 10).
- **Playwright Electron smoke test** (`e2e/smoke.spec.ts`): launch → log in against a real API → API stops → offline badge → run (fails) → paste the solution → submit → Accepted → solution unlocks offline. Screenshot: `desktop/test-results/offline-solved.png`.

## How to run

```bash
npm run build -w desktop      # core + web build + bundle main/preload/worker
npm run start -w desktop      # DSA_API_URL defaults to http://localhost:3000 (see desktop/.env.example)
npm run test:e2e -w desktop   # Playwright smoke test (needs the build)
```

## Notes for Person 2 (storage / sync API that is missing)

1. **No `/core/src/storage` yet.** The desktop wants a `LocalStore` with: `listProblems(filter)`, `getProblem(id)`, `saveProblems(problems)` (cache what was browsed online), `saveSubmission(submission)` (with a client id + `synced` flag), `pendingSubmissions()`, `markSynced(ids)`, `getSolvedIds()`. Today it uses bundled seeds + a JSON file (`desktop/src/offline-engine.ts`); swapping in your SQLite store touches only that file.
2. **better-sqlite3 in Electron** must be rebuilt for Electron's Node ABI (`electron-rebuild` / `@electron/rebuild`), or run the store in the utility process. Please pick one and document it.
3. **Sync:** offline submissions have `userId: 'offline'`; `/sync/push` needs to accept them and attach the signed-in user, and say how a conflict (problem solved on two devices) is reported back. Day 8 builds the UI for it.

## Known issues

1. Offline judging needs Node.js on `PATH` (core's sandbox runs `node`); CR-018 lets the app use its own Electron binary instead. macOS GUI apps get `/opt/homebrew/bin` and `/usr/local/bin` appended.
2. Offline progress isn't synced or shown in stats yet (Day 8). Stats and leaderboard say "needs a connection" offline.
3. Packaging the `@dsa-portal/core` workspace dependency into installers is untested (Day 10).
4. The renderer uses HashRouter so the same build works from `app://`.

## Design decisions (viva)

- **One UI for web and desktop:** the desktop loads the web build; the only difference is the injected `DesktopBridge` and an API wrapper that routes calls to the offline engine when there's no network.
- **Custom `app://` protocol instead of `file://`:** a real origin for CSP, workers and the IPC sender check.
- **Defence in depth:** sandboxed renderer → typed allow-listed IPC → argument validation → utility process → core's per-test child process with time/memory limits.
- **"Online" = API reachable**, not just "Wi-Fi on": a dead server or captive portal still means offline mode.
- **Secrets stay in main:** XSS in the renderer can't read the 7-day refresh token.
