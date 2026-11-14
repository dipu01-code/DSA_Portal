import { verdictOf } from '@dsa-portal/core';
import type { Submission, SubmissionRepository, PerTestResult } from '@dsa-portal/core';
import { pool, withTransaction } from '../pool';
import { updateStatsOnSubmission } from '../../modules/stats/stats.service';

interface SubmissionRow {
  id: string;
  user_id: string;
  problem_slug: string;
  code: string;
  status: 'queued' | 'running' | 'judged' | 'failed';
  passed: number;
  total: number;
  results: Array<PerTestResult & { testCaseIndex: number }> | null;
  created_at: Date;
  judged_at: Date | null;
  idempotency_key: string | null;
}

export class PostgresSubmissionRepository implements SubmissionRepository {
  async save(submission: Submission): Promise<void> {
    await withTransaction(async (client) => {
      // Resolve problem UUID from slug or id
      const probRes = await client.query<{ id: string }>(
        `SELECT id FROM problems WHERE slug = $1 OR id::text = $1 LIMIT 1`,
        [submission.problemId]
      );

      if (probRes.rows.length === 0) {
        throw new Error(`Problem not found: ${submission.problemId}`);
      }
      const problemUuid = probRes.rows[0].id;

      const perTest = submission.result?.perTest ?? [];
      const passed = perTest.filter((t) => t.passed).length;
      const total = perTest.length;
      const resultsJson = submission.result
        ? JSON.stringify(perTest.map((t, testCaseIndex) => ({ testCaseIndex, ...t })))
        : null;

      const insertOrUpdateSql = `
        INSERT INTO submissions (id, user_id, problem_id, code, status, passed, total, results, created_at, judged_at, idempotency_key)
        VALUES (
          COALESCE($1::uuid, gen_random_uuid()),
          $2::uuid,
          $3::uuid,
          $4,
          $5::submission_status,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11
        )
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          passed = EXCLUDED.passed,
          total = EXCLUDED.total,
          results = EXCLUDED.results,
          judged_at = EXCLUDED.judged_at;
      `;

      await client.query(insertOrUpdateSql, [
        submission.id || null,
        submission.userId,
        problemUuid,
        submission.code,
        submission.status,
        passed,
        total,
        resultsJson,
        submission.createdAt || new Date(),
        submission.judgedAt ?? null,
        submission.idempotencyKey ?? null,
      ]);

      // Stats counters in the same transaction as the result (CR-017: one owner for the stats SQL).
      await updateStatsOnSubmission(client, submission);
    });
  }

  async findById(id: string): Promise<Submission | null> {
    const sql = `
      SELECT s.*, p.slug AS problem_slug
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      WHERE s.id = $1::uuid
      LIMIT 1;
    `;
    const res = await pool.query<SubmissionRow>(sql, [id]);
    if (res.rows.length === 0) return null;

    return this.mapRowToSubmission(res.rows[0]);
  }

  async findByUser(userId: string): Promise<Submission[]> {
    const sql = `
      SELECT s.*, p.slug AS problem_slug
      FROM submissions s
      JOIN problems p ON s.problem_id = p.id
      WHERE s.user_id = $1::uuid
      ORDER BY s.created_at DESC;
    `;
    const res = await pool.query<SubmissionRow>(sql, [userId]);
    return res.rows.map((row) => this.mapRowToSubmission(row));
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Submission | null> {
    const res = await pool.query<SubmissionRow>(
      `SELECT s.*, p.slug AS problem_slug
       FROM submissions s
       JOIN problems p ON s.problem_id = p.id
       WHERE s.user_id = $1::uuid AND s.idempotency_key = $2
       LIMIT 1;`,
      [userId, key]
    );
    return res.rows[0] ? this.mapRowToSubmission(res.rows[0]) : null;
  }

  private mapRowToSubmission(row: SubmissionRow): Submission {
    // results stores core PerTestResult rows (+ testCaseIndex), so the ExecutionResult round-trips.
    const perTest: PerTestResult[] | undefined = row.results?.map(
      ({ testCaseIndex: _i, ...t }) => t
    );
    return {
      id: row.id,
      problemId: row.problem_slug,
      userId: row.user_id,
      code: row.code,
      status: row.status,
      result: perTest
        ? { problemId: row.problem_slug, status: verdictOf(perTest), perTest }
        : undefined,
      createdAt: row.created_at,
      judgedAt: row.judged_at ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
    };
  }
}
