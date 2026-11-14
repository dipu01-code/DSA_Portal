# Manual test checklist (Person 3, Day 9)

Automated coverage is listed at the end; this checklist covers what only a person on a real device can judge.
Mark each box with the date and initials, or the bug number from `bugs.md` when it fails.

**Setup for every run:** API + worker on PostgreSQL, migrated and seeded (`npm run db:migrate && npm run db:seed`), `npm run dev:server`, worker running (see `docs/handover/day-7-person-3.md`). Seed accounts use `password123`; or register a fresh account.

## 1. Expo app — Android emulator (Pixel 7 AVD, Android 14, development build)

Start: `cd mobile && npx expo run:android --no-bundler`, `EXPO_PUBLIC_API_URL=http://localhost:3100 npx expo start --port 8090`, `adb reverse tcp:8090 tcp:8090 && adb reverse tcp:3100 tcp:3100`.

| #    | Step                                                       | Expected                                                         | Result |
| ---- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| 1.1  | Open the app with no saved session                         | Sign-in screen, no crash, keyboard doesn't cover the button      | ☐      |
| 1.2  | Sign in with a wrong password                              | "Invalid email or password", fields keep their text              | ☐      |
| 1.3  | Register a new account                                     | Lands on Practice; daily-challenge card visible                  | ☐      |
| 1.4  | Kill and reopen the app                                    | Still signed in (refresh token in SecureStore)                   | ☐      |
| 1.5  | Practice → Arrays → Easy → Start                           | A problem opens; description, examples, hints                    | ☐      |
| 1.6  | Show hints one by one; Reveal solution                     | Hints appear in order; solution is locked before solving (alert) | ☐      |
| 1.7  | Type a solution with the key bar (`{ } ( ) ;` Tab), Submit | "Queued…" then "Accepted · n/n" with per-test rows               | ☐      |
| 1.8  | Stats tab, pull to refresh                                 | Solved count, accuracy, topic + difficulty bars, calendar        | ☐      |
| 1.9  | Leaderboard tab                                            | Your row marked "(you)"; Load more appears with > 50 users       | ☐      |
| 1.10 | Settings → Theme Dark, kill and reopen                     | Dark theme everywhere, kept after restart                        | ☐      |
| 1.11 | Settings → Theme System, switch the emulator to dark mode  | App follows the system                                           | ☐      |
| 1.12 | Rotate to landscape on the problem screen                  | Readable; no clipped buttons                                     | ☐      |
| 1.13 | TalkBack on: walk through Practice and Problem             | Every control has a spoken label; chips announce selected        | ☐      |
| 1.14 | Font size Largest (Android settings)                       | No text cut off on Practice, Problem, Stats                      | ☐      |

## 2. Expo app — one real Android phone (USB, `adb reverse`, or same Wi-Fi with the computer's LAN IP in `EXPO_PUBLIC_API_URL`)

| #    | Step                                                      | Expected                                                                                               | Result |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| 2.1  | Repeat 1.1–1.8 on the phone                               | Same results; typing in the editor is smooth                                                           | ☐      |
| 2.2  | Open two problems, then airplane mode                     | Sync bar: "○ Offline…"; Practice shows "On this phone" with both                                       | ☐      |
| 2.3  | Open one of them offline                                  | Problem readable (description, examples)                                                               | ☐      |
| 2.4  | Submit offline                                            | "Your submission is queued on this phone…"; bar "Offline · 1 queued"                                   | ☐      |
| 2.5  | Kill the app, reopen still offline                        | The queued item is still there (Settings → Sync)                                                       | ☐      |
| 2.6  | Airplane mode off                                         | Bar shows "Syncing 1…", then the problem screen / Settings show "Synced · Accepted n/n"; Stats updated | ☐      |
| 2.7  | Offline > 15 minutes, then reconnect                      | Still syncs (the access token is refreshed silently)                                                   | ☐      |
| 2.8  | Sign out while an item is queued, sign in as another user | The other user does not see the first user's queued code                                               | ☐      |
| 2.9  | Weak signal / toggle Wi-Fi quickly during a sync          | No duplicate submission on the server; item ends synced                                                | ☐      |
| 2.10 | Tablet or a large phone, landscape                        | Description and editor side by side at ≥ 768 pt                                                        | ☐      |

## 3. Desktop — macOS (`npm run build -w desktop && npm start -w desktop`, or the .dmg from Day 10)

| #    | Step                                                        | Expected                                                                                                                                     | Result |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3.1  | First launch                                                | Window opens; header badge "● Online"                                                                                                        | ☐      |
| 3.2  | Sign in, quit, relaunch                                     | Still signed in (token encrypted with Keychain via safeStorage)                                                                              | ☐      |
| 3.3  | Cmd+K                                                       | Focus jumps to the topic picker                                                                                                              | ☐      |
| 3.4  | Open a problem, Cmd+Enter                                   | Visible tests run locally                                                                                                                    | ☐      |
| 3.5  | Turn Wi-Fi off (or stop the API)                            | Badge "○ Offline" within a few seconds                                                                                                       | ☐      |
| 3.6  | Offline: Start a random problem, solve, Submit              | "Accepted" from the local sandbox; note "Judged on this computer…"; badge "Offline · 1 queued"                                               | ☐      |
| 3.7  | Offline: Reveal solution after solving                      | Unlocks                                                                                                                                      | ☐      |
| 3.8  | Wi-Fi back on                                               | Badge "Syncing 1…" → "Online"; panel "Synced · Accepted n/n"; Stats count it                                                                 | ☐      |
| 3.9  | Conflict (local verdict ≠ server verdict)                   | Hard to force by hand (same tests both sides); covered by `sync.test.ts` "flags a conflict". Manually: only check the wording if one appears | n/a    |
| 3.10 | Launch with the API down and no session: "Practise offline" | Guest practice works; on sign-in later the queued items sync to that account                                                                 | ☐      |
| 3.11 | System appearance Dark, theme "System"                      | Editor and charts switch without a restart                                                                                                   | ☐      |
| 3.12 | VoiceOver on: header, sync panel, problem page              | Badge announced; Esc closes the sync panel                                                                                                   | ☐      |
| 3.13 | Gatekeeper on the unsigned .dmg (Day 10)                    | Opens with right-click → Open (see code-signing notes)                                                                                       | ☐      |

## 4. Desktop — Windows 10/11 (the NSIS installer from Day 10)

| #   | Step                                      | Expected                                                             | Result |
| --- | ----------------------------------------- | -------------------------------------------------------------------- | ------ |
| 4.1 | Install, start from the Start menu        | SmartScreen warning for the unsigned build → "Run anyway"; app opens | ☐      |
| 4.2 | Repeat 3.1–3.8 with Ctrl instead of Cmd   | Same results; token stored with DPAPI via safeStorage                | ☐      |
| 4.3 | Offline judging with no Node.js installed | Works (the app judges with its own Electron binary, CR-018)          | ☐      |
| 4.4 | High-contrast mode / 150 % scaling        | Readable; focus outline visible                                      | ☐      |
| 4.5 | Uninstall                                 | Removed from Apps; user data folder documented in the manual         | ☐      |

## 5. Sync edge cases (any client)

| #   | Scenario                                                               | Expected                                                                | Result |
| --- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| 5.1 | Offline for a long time with several submissions                       | All queue in order; all sync in order on reconnect                      | ☐      |
| 5.2 | Session revoked while offline (log out that account on another device) | Queue kept; "Your session ended. Sign in to sync…"; syncs after sign-in | ☐      |
| 5.3 | Same account, two tabs/devices, both reconnect at once                 | Each queued item judged once on the server                              | ☐      |
| 5.4 | Problem deleted by an admin while a submission for it is queued        | Item "Not accepted: Problem not found"; others still sync               | ☐      |
| 5.5 | Server returns 5xx during sync                                         | "Sync problem"; item stays pending; Sync now retries                    | ☐      |

## Automated coverage (run before every manual pass)

| Suite       | Command                              | What it proves                                                                         |
| ----------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| ui-core     | `npm test -w ui-core` (54)           | API client, stores, outbox incl. edge cases 5.1–5.5, cache, hooks                      |
| web         | `npm test -w web` (15)               | screens, sync indicator, results, stats charts, editor panel                           |
| web e2e     | `npm run test:e2e -w web` (2)        | register → login → topic → solve → result → stats; offline submit → reconnect → synced |
| mobile      | `npm test -w mobile` (18)            | screens on the real stores, queued → synced, settings, SQLite                          |
| desktop e2e | `npm run test:e2e:ci -w desktop` (1) | launch → login → offline judging → reconnect → synced on the server                    |
