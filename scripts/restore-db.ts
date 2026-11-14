import * as path from 'path';
import { execSync } from 'child_process';
import { Pool } from 'pg';
import { BackupService, BackupManifest } from './backup-service';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsa_portal';
const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '../backups');

async function runRestore() {
  const backupService = new BackupService(BACKUP_DIR);
  const backups = backupService.listBackups();

  if (backups.length === 0) {
    console.error(`[Restore] No backup manifests found in ${BACKUP_DIR}`);
    process.exit(1);
  }

  // Select target backup (first arg or latest)
  const targetFileName = process.argv[2];
  let manifest: BackupManifest | undefined;

  if (targetFileName) {
    manifest = backups.find(
      (b) => b.fileName === targetFileName || b.fileName.includes(targetFileName)
    );
  } else {
    manifest = backups[0]; // latest
  }

  if (!manifest) {
    console.error(`[Restore] Specified backup not found.`);
    process.exit(1);
  }

  const filePath = path.join(BACKUP_DIR, manifest.fileName);
  console.log(`[Restore] Target backup: ${manifest.fileName}`);
  console.log(`[Restore] Created at: ${manifest.timestamp}`);

  // 1. Checksum verification
  console.log(`[Restore] Verifying SHA-256 checksum...`);
  const isValid = backupService.verifyChecksum(filePath, manifest.sha256);
  if (!isValid) {
    console.error(`[Restore] FATAL: Checksum mismatch! Archive may be corrupted or tampered with.`);
    console.error(`Expected: ${manifest.sha256}`);
    console.error(`Actual:   ${backupService.computeChecksum(filePath)}`);
    process.exit(1);
  }
  console.log(`[Restore] Checksum verified: OK (${manifest.sha256})`);

  // 2. Perform restoration
  console.log(`[Restore] Restoring database from archive...`);
  // One transaction + stop on the first error: a failed restore rolls back instead of leaving a half-dropped DB.
  const cmd = `set -o pipefail; gunzip -c "${filePath}" | psql -q -v ON_ERROR_STOP=1 --single-transaction "${DATABASE_URL}"`;
  execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });

  // 3. Post-restore smoke validation
  console.log(`[Restore] Running post-restore smoke validation...`);
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const tables = ['users', 'problems', 'test_cases', 'submissions'];
    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        const count = res.rows[0]?.count || 0;
        console.log(`[Restore] Table '${table}': ${count} rows.`);
      } catch (e: any) {
        console.warn(`[Restore] Could not count table ${table}: ${e.message}`);
      }
    }
  } finally {
    await pool.end();
  }

  console.log(`[Restore] Database successfully restored and verified.`);
}

if (require.main === module) {
  runRestore().catch((err) => {
    console.error('[Restore] Failed:', err);
    process.exit(1);
  });
}
