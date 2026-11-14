import type { Database } from 'better-sqlite3';
import type { DatabaseAdapter } from './adapter';

/**
 * BetterSqlite3Adapter: Wraps better-sqlite3 with WAL mode and asynchronous Promise signatures,
 * fitting the universal DatabaseAdapter interface.
 */
export class BetterSqlite3Adapter implements DatabaseAdapter {
  private db: Database;
  private isClosed = false;

  constructor(filename: string = ':memory:', options: { wal?: boolean } = {}) {
    // Lazy require: the native module loads only when a local store is opened, never in the server or
    // browser bundles. No silent in-memory fallback: that would "save" offline work and lose it on restart.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3');
    this.db = new BetterSqlite3(filename);
    if (options.wal !== false && filename !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('synchronous = NORMAL');
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.assertOpen();
    this.db.prepare(sql).run(...params);
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.assertOpen();
    return this.db.prepare(sql).all(...params) as T[];
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    this.assertOpen();
    return (this.db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async transaction<T>(cb: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.assertOpen();
    await this.execute('BEGIN TRANSACTION');
    try {
      const result = await cb(this);
      await this.execute('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.execute('ROLLBACK');
      } catch {
        // Ignore secondary rollback errors
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.isClosed) {
      this.db.close();
      this.isClosed = true;
    }
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new Error('DatabaseAdapter is closed');
    }
  }
}
