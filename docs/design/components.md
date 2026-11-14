# Component inventory and `/ui-core` structure (Day 1, built Day 2)

## `/ui-core` (shared by web, desktop renderer and mobile)

```
ui-core/src/
  api/
    schema.d.ts        generated from /docs/openapi.yaml (npm run gen:api -w ui-core)
    client.ts          fetch wrapper: base URL, bearer token, single-flight refresh on 401, GET retry with backoff, ApiError
    dsa-api.ts         DsaApi interface + createHttpApi (one typed function per endpoint)
  auth/refresh.ts      browserRefresh (cookie) and nativeRefresh (SecureStorage + Cookie header)
  stores/index.ts      Zustand (vanilla) stores: auth, problem session, submission, stats, settings
  hooks/index.tsx      DsaProvider, useDsa, useAuth, useProblem, useSubmission, useStats, useLeaderboard, useSettings
  adapters/
    types.ts           SecureStorage, NetworkStatus, Notifications interfaces
    web.ts             web implementations (memory storage, navigator.onLine, no-op notifications)
    desktop-bridge.ts  DesktopBridge: the typed API Electron's preload exposes as window.dsaDesktop
  theme/
    tokens.json        colours (light/dark), spacing, radii, type scale, motion — plain JSON for CSS and React Native
    index.ts           toCssVars(mode), contrastRatio()
  mocks/               MSW fake API + fixtures (browser worker for dev, node server for tests)
  create-dsa.ts        createDsa(config): client + api + stores wired together, one per app
```

Mobile adds `expo-secure-store` (SecureStorage), NetInfo (NetworkStatus), expo-notifications and an expo-sqlite adapter for Person 2's storage on Day 6.

## UI components (`/web/src`, reused by desktop)

| Component                                                                                | Purpose                                                    | State it reads               |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| `Layout`                                                                                 | header, nav, theme select, connectivity badge, skip link   | auth, settings, connectivity |
| `RequireAuth`                                                                            | route guard (signed in, or desktop offline guest)          | auth, connectivity           |
| `LoginPage`, `RegisterPage`                                                              | forms with inline errors                                   | auth                         |
| `HomePage`                                                                               | topic + difficulty picker → random problem                 | problem                      |
| `ProblemPage`                                                                            | description, examples, hints, solution, editor, run/submit | problem, submission          |
| `CodeEditor`                                                                             | Monaco (bundled, not CDN), Ctrl/Cmd+Enter = run            | settings                     |
| `ResultsPanel`                                                                           | per-test table for Run and Submit                          | –                            |
| `ConfirmDialog`                                                                          | native `<dialog>` (focus trap, Esc)                        | –                            |
| `StatsPage`                                                                              | tiles, two bar charts, table view, streak calendar         | stats                        |
| ⏳ `LeaderboardPage`, `DailyChallengeCard` (Day 7), `SyncStatus`, `SettingsPage` (Day 8) |                                                            |                              |

## Design tokens

Colours are checked in a unit test: text, muted text, primary, success, danger and warning reach WCAG AA (≥ 4.5:1) on every surface in both modes. The chart pair (`chart1` blue, `chart2` orange) was checked with the dataviz palette validator (colour-blind separation and ≥ 3:1 contrast) on both surfaces.
