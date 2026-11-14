import type { LocalStore, Problem, ProblemSummary } from '@dsa-portal/ui-core';
import type { StateStorage } from 'zustand/middleware';

/** The part of expo-sqlite's async API we use (lets tests pass another SQLite driver). */
export interface SqlDb {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: Array<string | number>): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: Array<string | number>): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: Array<string | number>): Promise<T[]>;
}

/** expo-sqlite implementation of LocalStore: problems the user opened, readable offline. */
export async function sqliteLocalStore(db: SqlDb): Promise<LocalStore> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS problems (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      json TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS problems_topic_difficulty ON problems (topic, difficulty);`);
  return {
    async saveProblem(p: Problem) {
      await db.runAsync(
        `INSERT INTO problems (id, title, topic, difficulty, json, saved_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, topic = excluded.topic, difficulty = excluded.difficulty,
           json = excluded.json, saved_at = excluded.saved_at`,
        p.id,
        p.title,
        p.topic,
        p.difficulty,
        JSON.stringify(p),
        Date.now()
      );
    },
    async getProblem(id: string) {
      const row = await db.getFirstAsync<{ json: string }>(
        'SELECT json FROM problems WHERE id = ?',
        id
      );
      return row ? (JSON.parse(row.json) as Problem) : null;
    },
    async listProblems(filter = {}) {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.topic) {
        where.push('topic = ?');
        params.push(filter.topic);
      }
      if (filter.difficulty) {
        where.push('difficulty = ?');
        params.push(filter.difficulty);
      }
      return db.getAllAsync<ProblemSummary>(
        `SELECT id, title, topic, difficulty FROM problems ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY saved_at DESC`,
        ...params
      );
    },
  };
}

/** Key-value StateStorage over SQLite for persisted settings and the sync outbox (no AsyncStorage dependency). */
export function sqliteKv(open: () => Promise<SqlDb>): StateStorage {
  let ready: Promise<SqlDb> | null = null;
  const kv = () =>
    (ready ??= open().then(async (db) => {
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);'
      );
      return db;
    }));
  return {
    getItem: async (k) =>
      (await (await kv()).getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', k))
        ?.value ?? null,
    setItem: async (k, v) =>
      void (await (
        await kv()
      ).runAsync(
        'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k,
        v
      )),
    removeItem: async (k) => void (await (await kv()).runAsync('DELETE FROM kv WHERE key = ?', k)),
  };
}
