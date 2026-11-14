# Day 2 — Person 3: shared UI core library (`/ui-core`) — usage guide

## What was built

Typed API client (types generated from `openapi.yaml` with openapi-typescript), Zustand stores, React hooks, platform adapters, MSW mock server. Structure: `docs/design/components.md`.

## How to run

```bash
npm test -w ui-core          # 31 tests (Vitest + MSW): refresh logic, every store, every hook
npm run gen:api -w ui-core   # regenerate src/api/schema.d.ts after openapi.yaml changes
npm run dev:mock -w web      # the web app against the MSW fake API (no server needed); login demo@dsa.dev / demo-pass-1
```

## Usage

```tsx
import {
  createDsa,
  DsaProvider,
  useAuth,
  useProblem,
  useSubmission,
  useStats,
  useLeaderboard,
} from '@dsa-portal/ui-core';

const dsa = createDsa({
  baseUrl: '' /* or 'http://localhost:3000' */,
  settingsStorage: localStorage,
});
void dsa.stores.auth.getState().restore(); // silent sign-in with the refresh token
<DsaProvider value={dsa}>
  <App />
</DsaProvider>;

const { status, user, login, logout, error } = useAuth();
const { setFilters, loadRandom, problem, code, setCode, nextHint, hints, revealSolution } =
  useProblem();
const { submit, status: subStatus, current } = useSubmission(); // submits with an Idempotency-Key, polls until judged
const { summary, streak, loading, error: statsError } = useStats();
const { entries } = useLeaderboard(20);
```

- Native platforms: `createDsa({ baseUrl, refresh: nativeRefresh(baseUrl, secureStorage), onTokens: (t) => secureStorage.set(REFRESH_TOKEN_KEY, t.refreshToken) })`.
- Tests in any client: `import { mockServer } from '@dsa-portal/ui-core/mocks/node'`.
- The stores are vanilla Zustand (`store.getState()`), so they also work outside React.

## API client behaviour

- Bearer token attached automatically; on 401 **one** shared refresh (single flight), then the request is replayed once; if refresh fails → `onAuthLost` → auth store `anonymous`.
- GETs retry on network errors, 429 and 5xx (3 attempts, exponential backoff with full jitter); POST/PUT/DELETE never retry (submissions use an Idempotency-Key instead).
- Every failure is an `ApiError { status, code, message, requestId }` (`status 0` = network, `code` = the server's `error`).

## Known issues

- Leaderboard and daily challenge have no store yet (hook only / Day 7). Socket push replaces polling on Day 7.
- `ui-core` is consumed as TypeScript source (bundled by Vite/esbuild/Metro), not prebuilt.

## Design decisions (viva)

- **Generated types** from the OpenAPI file: a spec change that breaks a client fails `tsc`, not production.
- **Stores depend on a `DsaApi` interface**, not on fetch: desktop swaps in its offline engine, tests swap in MSW.
- **Single-flight refresh** is required by refresh rotation: two parallel refreshes with one token would look like token theft.
- **Retry only idempotent GETs**: retrying a POST could create duplicates.
- **MSW mocks at the network layer**, so the real client code (headers, refresh, errors) is what gets tested.
