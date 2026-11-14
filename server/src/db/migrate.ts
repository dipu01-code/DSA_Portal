import * as fs from 'fs';
import * as path from 'path';
import { pool, withTransaction, closePool } from './pool';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Creates the migrations tracking table if it doesn't already exist
 */
async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Runs all pending .up.sql (or .sql) migrations in alphabetical order within transactions
 */
export async function migrateUp(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureMigrationsTable();

  const executedRes = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id ASC'
  );
  const executedNames = new Set(executedRes.rows.map((r) => r.name));

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return { applied: [], skipped: [] };
  }

  // Look for .up.sql files, fallback to .sql (excluding .down.sql and duplicate .up.sql targets)
  const allFiles = fs.existsSync(MIGRATIONS_DIR) ? fs.readdirSync(MIGRATIONS_DIR) : [];
  const upFiles = allFiles.filter((f) => f.endsWith('.up.sql'));
  const fallbackSqlFiles = allFiles.filter(
    (f) =>
      f.endsWith('.sql') &&
      !f.endsWith('.down.sql') &&
      !f.endsWith('.up.sql') &&
      !upFiles.includes(f.replace(/\.sql$/, '.up.sql'))
  );
  const files = [...upFiles, ...fallbackSqlFiles].sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const migrationKey = file.replace(/\.up\.sql$/, '').replace(/\.sql$/, '');

    if (executedNames.has(migrationKey)) {
      skipped.push(file);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    console.log(`[Migration UP] Applying ${file}...`);
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migrationKey]);
    });
    executedNames.add(migrationKey);

    console.log(`[Migration UP] Successfully applied ${file}`);
    applied.push(file);
  }

  return { applied, skipped };
}

/**
 * Rolls back applied migrations in reverse order using .down.sql files
 */
export async function migrateDown(): Promise<{ rolledBack: string[] }> {
  await ensureMigrationsTable();

  const executedRes = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id DESC'
  );

  const rolledBack: string[] = [];

  for (const row of executedRes.rows) {
    const downFile = `${row.name}.down.sql`;
    const downPath = path.join(MIGRATIONS_DIR, downFile);

    if (fs.existsSync(downPath)) {
      const sql = fs.readFileSync(downPath, 'utf8');
      console.log(`[Migration DOWN] Rolling back ${downFile}...`);
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query('DELETE FROM _migrations WHERE name = $1', [row.name]);
      });
      console.log(`[Migration DOWN] Successfully rolled back ${downFile}`);
      rolledBack.push(downFile);
    } else {
      console.warn(`[Migration DOWN] No down migration found for ${row.name}`);
    }
  }

  return { rolledBack };
}

/**
 * Full reset: migrate down, then migrate up
 */
export async function migrateReset(): Promise<void> {
  console.log('[Migration RESET] Starting database reset...');
  await migrateDown();
  await migrateUp();
  console.log('[Migration RESET] Database reset complete.');
}

// CLI entry point: tsx server/src/db/migrate.ts [up|down|reset]
if (require.main === module) {
  const command = process.argv[2] || 'up';

  const run = async () => {
    if (command === 'down') {
      const { rolledBack } = await migrateDown();
      console.log(`Rollback complete. Rolled back: ${rolledBack.length} migrations.`);
    } else if (command === 'reset') {
      await migrateReset();
    } else {
      const { applied, skipped } = await migrateUp();
      console.log(`Migration up complete. Applied: ${applied.length}, Skipped: ${skipped.length}`);
    }
  };

  run()
    .then(() => closePool().then(() => process.exit(0)))
    .catch((err) => {
      console.error('Migration error:', err);
      closePool().then(() => process.exit(1));
    });
}
