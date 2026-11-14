/** Core's local (offline) store on real SQLite via better-sqlite3: a file on disk, not a stand-in. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BetterSqlite3Adapter,
  initSqliteSchema,
  SqliteProblemRepository,
  SqliteStatsRepository,
  SqliteSubmissionRepository,
} from '../../src/storage';
import { PROBLEMS } from '../../src/problems';
import type { Submission } from '../../src/types';

describe('SQLite storage (better-sqlite3)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-sqlite-'));
  const file = path.join(dir, 'local.db');
  const problem = PROBLEMS[0];
  const submission: Submission = {
    id: 'sub-1',
    problemId: problem.id,
    userId: 'local-user',
    code: 'function solve() {}',
    status: 'judged',
    createdAt: new Date(),
    result: {
      problemId: problem.id,
      status: 'passed',
      perTest: [
        { id: '0', passed: true, expected: 1, actual: 1, runtimeMs: 1 },
        { id: '1', passed: true, expected: 2, actual: 2, runtimeMs: 1 },
      ],
    },
  };

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('saves a problem and a judged submission, and they survive reopening the file', async () => {
    const db = new BetterSqlite3Adapter(file);
    await initSqliteSchema(db);
    await new SqliteProblemRepository(db).save(problem);
    await new SqliteSubmissionRepository(db).save(submission);
    await db.close();

    const reopened = new BetterSqlite3Adapter(file);
    const found = await new SqliteSubmissionRepository(reopened).findById('sub-1');
    expect(found?.result).toEqual({
      problemId: problem.id,
      status: 'passed',
      perTest: submission.result!.perTest,
    });
    expect((await new SqliteProblemRepository(reopened).findById(problem.id))?.title).toBe(
      problem.title
    );

    const stats = await new SqliteStatsRepository(reopened).getUserStats('local-user');
    expect(stats).toMatchObject({ attempted: 1, solved: 1, totalProblems: 1 });
    await reopened.close();
  });

  it('rolls a failed transaction back', async () => {
    const db = new BetterSqlite3Adapter(':memory:');
    await initSqliteSchema(db);
    await expect(
      new SqliteSubmissionRepository(db).save({
        ...submission,
        id: 'sub-2',
        problemId: 'no-such-problem',
      })
    ).rejects.toThrow(/Problem not found/);
    expect(await db.query('SELECT id FROM submissions')).toEqual([]);
    await db.close();
  });
});
