/**
 * Runs the real SQL against SQLite (better-sqlite3, works on Node 20 like CI), wrapped in expo-sqlite's async API.
 */
import { sqliteKv, sqliteLocalStore, type SqlDb } from './local-store';
import type { Problem } from '@dsa-portal/ui-core';
import Database from 'better-sqlite3';

function nodeSqlite(): SqlDb {
  const db = new Database(':memory:');
  return {
    execAsync: async (sql) => {
      db.exec(sql);
    },
    runAsync: async (sql, ...p) => db.prepare(sql).run(...p),
    getFirstAsync: async <T>(sql: string, ...p: Array<string | number>) =>
      (db.prepare(sql).get(...p) as T) ?? null,
    getAllAsync: async <T>(sql: string, ...p: Array<string | number>) =>
      db
        .prepare(sql)
        .all(...p)
        .map((r) => ({ ...(r as object) })) as T[],
  };
}

const problem = (id: string, topic: string, difficulty: Problem['difficulty']): Problem => ({
  id,
  title: id.toUpperCase(),
  topic,
  difficulty,
  description: 'd',
  starterCode: 's',
  testCases: [{ input: '1', expected: '1' }],
  hints: ['h'],
  solution: '',
});

describe('sqliteLocalStore', () => {
  it('saves, updates, reads and filters problems', async () => {
    const store = await sqliteLocalStore(nodeSqlite());
    await store.saveProblem(problem('a', 'Arrays', 'Easy'));
    await store.saveProblem(problem('b', 'Graphs', 'Hard'));
    await store.saveProblem({ ...problem('a', 'Arrays', 'Easy'), title: 'A v2' });

    expect((await store.getProblem('a'))?.title).toBe('A v2');
    expect(await store.getProblem('missing')).toBeNull();
    expect((await store.listProblems()).map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(await store.listProblems({ topic: 'Graphs', difficulty: 'Hard' })).toEqual([
      { id: 'b', title: 'B', topic: 'Graphs', difficulty: 'Hard' },
    ]);
    expect(await store.listProblems({ topic: 'Graphs', difficulty: 'Easy' })).toEqual([]);
  });

  it('is safe to open twice (CREATE IF NOT EXISTS)', async () => {
    const db = nodeSqlite();
    await (await sqliteLocalStore(db)).saveProblem(problem('a', 'Arrays', 'Easy'));
    expect(await (await sqliteLocalStore(db)).getProblem('a')).not.toBeNull();
  });
});

describe('sqliteKv', () => {
  it('stores, overwrites and removes values (settings + sync outbox)', async () => {
    const db = nodeSqlite();
    const kv = sqliteKv(async () => db);
    expect(await kv.getItem('dsa.outbox')).toBeNull();
    await kv.setItem('dsa.outbox', '{"a":1}');
    await kv.setItem('dsa.outbox', '{"a":2}');
    expect(await sqliteKv(async () => db).getItem('dsa.outbox')).toBe('{"a":2}');
    await kv.removeItem('dsa.outbox');
    expect(await kv.getItem('dsa.outbox')).toBeNull();
  });
});
