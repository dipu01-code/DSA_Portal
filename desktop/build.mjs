// Bundles the Electron main process, preload and sandbox worker. @dsa-portal/core stays external:
// its sandbox runs sandbox-exec.js from its own folder (__dirname), which bundling would break.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};
await build({
  ...common,
  entryPoints: ['src/main.ts', 'src/sandbox-worker.ts'],
  outdir: 'dist',
  external: ['electron', '@dsa-portal/core'],
});
// The sandboxed preload may only require 'electron', so everything else is inlined.
await build({ ...common, entryPoints: ['src/preload.ts'], outdir: 'dist', external: ['electron'] });
