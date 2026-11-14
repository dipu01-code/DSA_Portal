/**
 * Web e2e on the real server app (e2e/test-api.ts): register → login → choose topic → solve →
 * see the result → see stats; then the offline scenario: submit offline → reconnect → synced.
 */
import { test, expect, type Page } from '@playwright/test';
import { SEED_PROBLEMS } from '../../server/src/db/seeds/problems-data';

const user = {
  username: `e2e_${Date.now().toString(36)}`,
  email: `e2e_${Date.now()}@dsa.dev`,
  password: 'green-lamp-42',
};

/** Replaces the Monaco content via the clipboard, like a user pasting their solution. */
async function paste(page: Page, code: string) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), code);
  await page.locator('.monaco-editor .view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
}

async function openRandom(page: Page, topic: string, difficulty: string) {
  await page.goto('/#/');
  await page.getByLabel('Topic').selectOption(topic);
  await page.getByRole('radio', { name: difficulty }).check();
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForURL(/#\/problem\//);
  await expect(page.getByRole('button', { name: 'Run tests' })).toBeVisible();
  const title = (await page.getByRole('heading', { level: 1 }).textContent())!;
  await expect(page.getByLabel('Code editor')).toBeVisible({ timeout: 30_000 });
  return SEED_PROBLEMS.find((p) => p.title === title)!;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('register → login → choose topic → solve → result → stats', async ({ page }) => {
  await page.goto('/#/register');
  await page.getByLabel('Username').fill(user.username);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

  // Log out and back in with the new account.
  await page.getByRole('button', { name: `Log out ${user.username}` }).click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('wrong-password-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Practice' })).toBeVisible();

  const problem = await openRandom(page, 'Arrays', 'Easy');
  // Starter code fails the visible tests (run in the browser), the reference solution is accepted by the server.
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByText('Some tests fail')).toBeVisible();
  await paste(page, problem.solution.code);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Accepted', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(`${problem.testCases.length}/${problem.testCases.length} passed`)
  ).toBeVisible();

  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page.getByRole('heading', { name: 'Your progress' })).toBeVisible();
  await expect(page.getByText(`1/${SEED_PROBLEMS.length}`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By topic' })).toBeVisible();
});

test('offline: submit is queued, then syncs on reconnect', async ({ page, context }) => {
  await page.goto('/#/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const problem = await openRandom(page, 'Strings', 'Easy');
  await paste(page, problem.solution.code);

  await context.setOffline(true);
  await expect(page.getByText('○ Offline', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run tests' }).click(); // runs in a Web Worker: works offline
  await expect(page.getByText('All visible tests pass')).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(/Your submission is queued on this device/)).toBeVisible();
  await expect(page.getByText('○ Offline · 1 queued')).toBeVisible();

  // The problem stays readable offline after a reload of the list view.
  await page.getByRole('link', { name: 'Practice' }).click();
  await expect(page.getByRole('heading', { name: 'On this device' })).toBeVisible();
  await expect(page.getByRole('link', { name: problem.title })).toBeVisible();

  await context.setOffline(false);
  await page.getByLabel(/^Sync status/).click();
  await expect(page.getByText(/^Synced · Accepted/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('● Online', { exact: true })).toBeVisible();
});
