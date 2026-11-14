import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Pool } from 'pg';
import { BackupService } from './backup-service';

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dsa_portal';
const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(__dirname, '../backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);

async function runBackup() {
  const backupService = new BackupService(BACKUP_DIR, RETENTION_DAYS);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `dsa_portal_backup_${timestamp}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, fileName);

  console.log(`[Backup] Starting PostgreSQL backup to ${filePath}...`);

  // Query table counts directly via PG pool
  const pool = new Pool({ connectionString: DATABASE_URL });
  const tableCounts: Record<string, number> = {};

  try {
    const tables = [
      'users',
      'problems',
      'test_cases',
      'submissions',
      'user_problem_stats',
      'sync_op_log',
    ];
    for (const table of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
        tableCounts[table] = res.rows[0]?.count || 0;
      } catch {
        tableCounts[table] = 0;
      }
    }
  } finally {
    await pool.end();
  }

  // pipefail: a failing pg_dump must fail the backup, not leave a valid-looking empty .gz behind.
  try {
    const cmd = `set -o pipefail; pg_dump "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges | gzip > "${filePath}"`;
    execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    throw err;
  }

  const manifest = backupService.createManifest({
    fileName,
    filePath,
    database: 'dsa_portal',
    schemaVersion: '003',
    tableCounts,
  });

  console.log(`[Backup] Backup completed successfully.`);
  console.log(`[Backup] ID: ${manifest.id}`);
  console.log(`[Backup] Size: ${manifest.fileSizeBytes} bytes`);
  console.log(`[Backup] SHA-256: ${manifest.sha256}`);

  const pruned = backupService.pruneOldBackups();
  if (pruned.length > 0) {
    console.log(`[Backup] Pruned ${pruned.length} expired backups: ${pruned.join(', ')}`);
  }
}

if (require.main === module) {
  runBackup().catch((err) => {
    console.error('[Backup] Failed:', err);
    process.exit(1);
  });
}
