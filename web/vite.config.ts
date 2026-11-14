/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the same build also loads inside Electron (app:// protocol).
  base: './',
  server: {
    port: 5173,
    // Same origin in dev: the HttpOnly refresh cookie (SameSite=Strict, Path=/api/v1/auth) just works.
    // API_PROXY lets the e2e tests point the dev server at their own throwaway API.
    proxy: {
      '/api': process.env.API_PROXY ?? 'http://localhost:3000',
      '/socket.io': {
        target: (process.env.API_PROXY ?? 'http://localhost:3000').replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    env: { VITE_API_URL: 'http://api.test', VITE_REALTIME: '0' },
    setupFiles: ['src/test-setup.ts'],
  },
});
