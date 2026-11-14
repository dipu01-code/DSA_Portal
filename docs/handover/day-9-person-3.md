# Day 9 — Person 3: client testing and bug fixing

## What was built

- **Component tests (React Testing Library, `web/src/components.test.tsx`):** editor panel (run, Ctrl/Cmd+Enter, reset, submit → Judging… → Accepted), results panel (empty / pending / error / pass), stats charts (skeleton → charts + accessible table + calendar; error → retry), sync indicator (offline count, conflicts and refusals, Sync now, Esc closes).
- **Playwright e2e for the web app (`web/e2e`):** against the real server app on in-memory stores with the 40 seed problems and a stand-in worker (`e2e/test-api.ts`, started by Playwright with tsx) plus the Vite dev server.
  1. register → log out → wrong password → login → Arrays/Easy → Run (fails) → paste the solution → Submit → Accepted n/n → Stats shows 1/40.
  2. offline (`context.setOffline`): Run still works (Web Worker) → Submit is queued → "On this device" lists the problem → online → "Synced · Accepted".
- **Electron smoke test in CI form:** `npm run test:e2e:ci -w desktop` (build + test), CI mode retries once, GitHub annotations, `--no-sandbox` on runners; workflow proposed in **CR-031** (`/.github` is Person 2's).
- **Sync edge cases (`ui-core/src/sync-edge.test.ts`)** on the full client against the mock API: long offline with an expired access token (one refresh, all replay in order), session ended while offline (queue kept, "Sign in to sync", syncs after sign-in), flaky reconnects (no loss, no duplicates), two tabs replaying one outbox (Idempotency-Key → one submission).
- **`docs/test/manual-checklist.md`:** Android emulator, one real Android phone, macOS and Windows desktop, sync edge cases.
- **`docs/test/bugs.md`:** 15 bugs; the top 12 fixed with regression tests, 2 open, 1 won't fix. Highlights: logout leaked the last user's stats/problem (fixed), the sync panel showed other users' queued code (fixed), the problem page stayed "queued" after syncing (fixed), raw "Failed to fetch" errors (fixed), editor/charts ignored system dark mode (fixed), leaderboard Load more (added).

## How to run

```bash
npm test -w ui-core        # 54
npm test -w web            # 15
npm test -w mobile         # 18
npm run test:e2e -w web    # 2  (uses the installed Google Chrome; PW_CHANNEL= to use Playwright's Chromium)
npm run test:e2e:ci -w desktop   # 1  (Linux CI: xvfb-run -a …)
```

## For others

- `errorMessage(e)` (ui-core): user-facing error text; network failures become one plain sentence.
- `useLeaderboard()` now returns `nextCursor` and `loadMore()`.
- `SubmissionState.queuedKey`: the outbox key of an offline submission.
- `web/e2e/test-api.ts` is a ready throwaway API (real app, in-memory, seed problems, fake worker) others can use for UI tests.
- The mock API (ui-core/mocks) now honours `Idempotency-Key` and leaderboard paging like the server.
- CR-031 (Person 2): the CI workflow for these suites.

## Known issues

1. Bug 13 (open): login throttling is per process; move it to Redis.
2. Bug 14 (open): desktop offline-guest submissions sync to whoever signs in next.
3. The manual checklist is written but not yet ticked on a real phone or on Windows (no Windows machine here).
4. CI workflow not added (Person 2's folder, CR-031).

## Design decisions (viva)

- **Test pyramid:** most logic is in ui-core, so most tests are fast unit tests there; RTL for components; two e2e flows per platform for the paths that must never break.
- **E2E on the real server code, not mocks:** `test-api.ts` boots the actual Fastify app with in-memory stores, so the e2e test also checks the API contract and auth cookies; only the queue worker is replaced.
- **Offline is tested as the user meets it:** `context.setOffline` on web, an API that stops answering on desktop, a fake network adapter in ui-core: same code paths as real outages.
- **Every fixed bug gets a regression test** in the cheapest layer that can see it.
- **Privacy bugs first:** shared devices are common in labs, so leaking the previous user's data ranked above visual issues.
