import type { Submission } from '@dsa-portal/core';
import { pool } from '../../db/pool';
import type { InMemorySubmissionRepository } from './in-memory-submission.repository';

/** A submission in the dead-letter list (status `failed`). */
export interface FailedJob {
  id: string;
  problemId: string;
  userId: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  failedAt: Date | null;
}

/** What the API needs from the queue: depth for backpressure, and the admin dead-letter actions. */
export interface SubmissionQueue {
  waitingCount(): Promise<number>;
  /** Newest failure first; `after` is the last row of the previous page. */
  listFailed(limit: number, after?: { failedAt: string; id: string }): Promise<FailedJob[]>;
  /** failed → queued with a fresh attempt budget. False if the id is not in the dead-letter list. */
  requeue(id: string): Promise<boolean>;
  /** created_at of the user's n-th newest submission after `since`, or null if they made fewer than n (quotas). */
  nthNewestSince(userId: string, n: number, since: Date): Promise<Date | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the queue columns added by migration 003 (the worker side lives in /workers/src/pg-queue.ts). */
export class PostgresSubmissionQueue implements SubmissionQueue {
  async waitingCount() {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM submissions WHERE status = 'queued'`
    );
    return rows[0].n;
  }

  async listFailed(limit: number, after?: { failedAt: string; id: string }) {
    const { rows } = await pool.query<FailedJob>(
      `SELECT s.id, p.slug AS "problemId", s.user_id AS "userId", s.attempts, s.last_error AS "lastError",
              s.created_at AS "createdAt", s.judged_at AS "failedAt"
       FROM submissions s JOIN problems p ON p.id = s.problem_id
       WHERE s.status = 'failed'
         -- Cursor times come back from JS with ms precision; compare at ms so no row is skipped.
         AND ($2::timestamptz IS NULL OR (date_trunc('milliseconds', s.judged_at), s.id) < ($2::timestamptz, $3::uuid))
       ORDER BY date_trunc('milliseconds', s.judged_at) DESC NULLS LAST, s.id DESC
       LIMIT $1`,
      [limit, after?.failedAt ?? null, after?.id ?? null]
    );
    return rows;
  }

  async requeue(id: string) {
    if (!UUID.test(id)) return false;
    const { rowCount } = await pool.query(
      `UPDATE submissions
       SET status = 'queued', attempts = 0, run_after = now(), judged_at = NULL, last_error = NULL
       WHERE id = $1 AND status = 'failed'`,
      [id]
    );
    return rowCount === 1;
  }

  async nthNewestSince(userId: string, n: number, since: Date) {
    // Walks idx_submissions_user_cursor (user_id, created_at DESC) and stops at row n.
    const { rows } = await pool.query<{ createdAt: Date }>(
      `SELECT created_at AS "createdAt" FROM submissions
       WHERE user_id = $1 AND created_at > $2
       ORDER BY created_at DESC OFFSET $3 LIMIT 1`,
      [userId, since, n - 1]
    );
    return rows[0]?.createdAt ?? null;
  }
}

/** For tests and running the API without a database. Never full, keeps no retry metadata. */
export class InMemorySubmissionQueue implements SubmissionQueue {
  constructor(private submissions: InMemorySubmissionRepository) {}

  async waitingCount() {
    return this.submissions.all().filter((s) => s.status === 'queued').length;
  }

  async listFailed(limit: number, after?: { failedAt: string; id: string }) {
    const key = (s: Submission) => `${s.judgedAt?.toISOString() ?? ''}|${s.id}`;
    const afterKey = after && `${after.failedAt}|${after.id}`;
    return this.submissions
      .all()
      .filter((s) => s.status === 'failed')
      .sort((a, b) => key(b).localeCompare(key(a)))
      .filter((s) => !afterKey || key(s) < afterKey)
      .slice(0, limit)
      .map((s) => ({
        id: s.id,
        problemId: s.problemId,
        userId: s.userId,
        attempts: 1,
        lastError: null,
        createdAt: s.createdAt,
        failedAt: s.judgedAt ?? null,
      }));
  }

  async requeue(id: string) {
    const s = await this.submissions.findById(id);
    if (s?.status !== 'failed') return false;
    s.status = 'queued';
    s.judgedAt = undefined;
    return true;
  }

  async nthNewestSince(userId: string, n: number, since: Date) {
    const times = (await this.submissions.findByUser(userId))
      .map((s) => s.createdAt)
      .filter((t) => t > since)
      .sort((a, b) => b.getTime() - a.getTime());
    return times[n - 1] ?? null;
  }
}
