// Single-container start for hosts with no background workers or shell (Render free plan):
// migrate, seed a fresh database, then run the API and the judging worker side by side.
// If either process exits, stop the other and exit too, so the host restarts the whole service
// instead of leaving an API whose submissions are never judged.
const { spawn, spawnSync } = require('child_process');

const node = (args) => spawnSync(process.execPath, args, { stdio: 'inherit' });
for (const step of [
  ['server/dist/db/migrate.js', 'up'],
  ['server/dist/db/seed.js', '--if-empty'],
]) {
  const { status } = node(step);
  if (status !== 0) process.exit(status ?? 1);
}

const procs = ['server/dist/index.js', 'workers/dist/main.js'].map((file) =>
  spawn(process.execPath, [file], { stdio: 'inherit' })
);
let stopping = false;
const stopAll = (signal) => {
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill(signal);
};
for (const p of procs) {
  p.on('exit', (code) => {
    if (!stopping) {
      console.error(`[start-all] ${p.spawnargs[1]} exited (${code}); stopping the service`);
      process.exitCode = code || 1;
      stopAll('SIGTERM');
    }
  });
}
// The worker finishes its current job on SIGTERM before exiting.
process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('SIGINT', () => stopAll('SIGINT'));
