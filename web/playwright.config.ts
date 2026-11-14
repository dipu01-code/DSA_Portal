import { defineConfig } from '@playwright/test';

const API_PORT = 3999;
const WEB_PORT = 5199;

/**
 * Web e2e: Vite dev server + a throwaway in-memory API (e2e/test-api.ts). Uses the installed
 * Google Chrome (GitHub's Ubuntu runners have it too); PW_CHANNEL='' falls back to Playwright's Chromium.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `npx tsx e2e/test-api.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: { PORT: String(API_PORT) },
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: {
        API_PROXY: `http://127.0.0.1:${API_PORT}`,
        VITE_API_URL: '',
        VITE_REALTIME: '0',
        VITE_MOCK: '0',
      },
      reuseExistingServer: false,
    },
  ],
});
