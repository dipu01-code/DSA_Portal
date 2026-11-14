/**
 * Desktop smoke test: launch → log in against a real API → API goes away → run and submit a
 * problem with the offline engine → API comes back → the queued submission syncs and is judged
 * on the server. Needs `npm run build -w desktop` first (web/dist + desktop/dist).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FastifyInstance } from 'fastify';

process.env.BCRYPT_COST = '4'; // read when the auth module loads (dynamic import below)
const USER = { username: 'desk_user', email: 'desk@dsa.dev', password: 'blue-kettle-42' };

let api: FastifyInstance;
let app: ElectronApplication;
let win: Page;
let down = false; // "network off": every API request fails, as if unreachable
let worker: NodeJS.Timeout | undefined;

test.beforeAll(async () => {
  // The real server app (auth/admin/stats wired in app.ts since CR-010), with in-memory stores.
  const { buildApp } = await import('../../server/src/app');
  const { InMemorySubmissionRepository } =
    await import('../../server/src/modules/submissions/in-memory-submission.repository');
  const { submitCodeSandboxAsync } = await import('../../core/src/sandbox');
  const { SEED_PROBLEMS } = await import('../../server/src/db/seeds/problems-data');
  const { InMemoryProblemRepository } =
    await import('../../server/src/modules/problems/in-memory-problem.repository');
  const submissions = new InMemorySubmissionRepository();
  // The same 40 problems the app bundles for offline use (and PostgreSQL is seeded with).
  api = buildApp({
    logger: false,
    submissions,
    problems: new InMemoryProblemRepository(SEED_PROBLEMS),
  });
  api.addHook('onRequest', async (_req, reply) => {
    if (down) await reply.code(503).send({ error: 'DOWN', message: 'offline' });
  });
  // Stand-in for the BullMQ worker: judges queued submissions with core's sandbox.
  let busy = false;
  worker = setInterval(async () => {
    if (busy) return;
    busy = true;
    for (const s of submissions.all().filter((x) => x.status === 'queued')) {
      const result = await submitCodeSandboxAsync(
        SEED_PROBLEMS.find((p) => p.id === s.problemId)!,
        s.code
      );
      await submissions.save({ ...s, status: 'judged', result, judgedAt: new Date() });
    }
    busy = false;
  }, 200);
  const url = await api.listen({ port: 0, host: '127.0.0.1' });
  const reg = await fetch(`${url}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(USER),
  });
  expect(reg.status).toBe(201);

  // DSA_PACKAGED_APP = path to an installed/packaged binary (e.g. release/mac-arm64/DSA Practice.app/Contents/MacOS/DSA Practice):
  // the same test then checks the installer's output instead of the dev build.
  const packaged = process.env.DSA_PACKAGED_APP;
  // CI containers/runners often lack the setuid sandbox helper; the app's own window sandbox stays on.
  const ciArgs = process.env.CI ? ['--no-sandbox'] : [];
  app = await electron.launch({
    ...(packaged
      ? { executablePath: packaged, args: ciArgs }
      : { args: [path.join(__dirname, '../dist/main.js'), ...ciArgs] }),
    env: {
      ...process.env,
      DSA_API_URL: url,
      DSA_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-desktop-')),
      DSA_NETWORK_POLL_MS: '300',
    } as Record<string, string>,
  });
  win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('renderer error:', e));
});

test.afterAll(async () => {
  clearInterval(worker);
  await app?.close();
  await api?.close();
});

test('logs in online, then practises offline with the local sandbox', async () => {
  await expect(win.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(win.getByText('● Online')).toBeVisible();

  // The window is locked down: no Node in the page, only the typed bridge.
  expect(
    await win.evaluate(() => [
      typeof (globalThis as { require?: unknown }).require,
      typeof (globalThis as { process?: unknown }).process,
      typeof (window as { dsaDesktop?: { offline: { run: unknown } } }).dsaDesktop?.offline.run,
    ])
  ).toEqual(['undefined', 'undefined', 'function']);

  await win.getByLabel('Email').fill(USER.email);
  await win.getByLabel('Password').fill(USER.password);
  await expect(win.getByLabel('Email')).toHaveValue(USER.email);
  await win.getByRole('button', { name: 'Sign in' }).click();
  await expect(win.getByRole('heading', { name: 'Practice' })).toBeVisible();

  // "Network off": the API stops answering, the app switches to offline mode by itself.
  down = true;
  await expect(win.getByText('○ Offline', { exact: true })).toBeVisible({ timeout: 10_000 });

  await win.getByLabel('Topic').selectOption('Arrays');
  await win.getByRole('radio', { name: 'Easy' }).check();
  await win.getByRole('button', { name: 'Start' }).click();
  const title = (await win.getByRole('heading', { level: 1 }).textContent())!;
  await expect(win.getByRole('button', { name: 'Run tests' })).toBeVisible();
  await expect(win.getByLabel('Code editor')).toBeVisible({ timeout: 20_000 });

  // Starter code runs in the local sandbox and fails.
  await win.getByRole('button', { name: 'Run tests' }).click();
  await expect(win.getByText('Some tests fail')).toBeVisible({ timeout: 30_000 });

  // Paste the reference solution of whatever problem we got and submit: judged offline.
  const { SEED_PROBLEMS } = await import('../../server/src/db/seeds/problems-data');
  const solution = SEED_PROBLEMS.find((p) => p.title === title)!.solution.code;
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), solution);
  await win.locator('.monaco-editor .view-lines').click();
  await win.keyboard.press('ControlOrMeta+A');
  await win.keyboard.press('ControlOrMeta+V');
  await win.getByRole('button', { name: 'Submit' }).click();
  await expect(win.getByText('Accepted', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(win.getByText('○ Offline · 1 queued')).toBeVisible();

  // Solved locally → the solution unlocks offline too.
  await win.getByRole('button', { name: 'Reveal solution…' }).click();
  await win.getByRole('button', { name: 'Reveal', exact: true }).click();
  await expect(win.locator('pre.solution')).toContainText('function solve');
  await win.screenshot({ path: path.join(__dirname, '../test-results/offline-solved.png') });

  // Network back: the outbox replays the submission, the server judges it, the panel says so.
  down = false;
  await win.getByLabel(/^Sync status/).click();
  await expect(win.getByText(/^Synced · Accepted/)).toBeVisible({ timeout: 30_000 });
  await expect(win.getByText('● Online', { exact: true })).toBeVisible();
  await win.screenshot({ path: path.join(__dirname, '../test-results/synced.png') });
});
