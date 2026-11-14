// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one (test-only stub).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup); // RTL auto-cleanup needs vitest globals, which are off
