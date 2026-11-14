import type { ProblemRepository } from '@dsa-portal/core';
import { pool } from '../../db/pool';
import type { InMemorySubmissionRepository } from '../submissions/in-memory-submission.repository';
import type { AuthStore } from '../auth/store';

/** One user's totals for the period, before ranking. */
export interface LeaderboardRow {
  userId: string;
  username: string;
  solved: number;
  /** Easy 1, Medium 2, Hard 3 per solved problem. */
  totalScore: number;
  /** When the user reached their solved count: earlier wins a tie ("total time"). */
  lastSolvedAt: Date;
}

export interface LeaderboardStore {
  /** Users with at least one first solve at or after `since` (all time when null). Any order. */
  rows(since: Date | null): Promise<LeaderboardRow[]>;
}

const POINTS: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3 };

export class PostgresLeaderboardStore implements LeaderboardStore {
  async rows(since: Date | null) {
    // shortcut: ranks every user with a solve on each request (fine for thousands); precompute in a table if it grows.
    const { rows } = await pool.query<LeaderboardRow>(
      `SELECT u.id AS "userId", u.username, count(*)::int AS solved,
              sum(CASE p.difficulty WHEN 'Easy' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END)::int AS "totalScore",
              max(ups.first_solved_at) AS "lastSolvedAt"
       FROM user_problem_stats ups
       JOIN users u ON u.id = ups.user_id
       JOIN problems p ON p.id = ups.problem_id
       WHERE ups.solved AND ups.first_solved_at IS NOT NULL
         AND ($1::timestamptz IS NULL OR ups.first_solved_at >= $1)
       GROUP BY u.id, u.username`,
      [since]
    );
    return rows;
  }
}

/** No database: first solve = earliest fully passing judged submission per user and problem. */
export class InMemoryLeaderboardStore implements LeaderboardStore {
  constructor(
    private submissions: InMemorySubmissionRepository,
    private problems: ProblemRepository,
    private auth: Pick<AuthStore, 'findById'>
  ) {}

  async rows(since: Date | null) {
    const firstSolve = new Map<string, Date>(); // "user|problem" → first solve
    for (const s of this.submissions.all()) {
      const tests = s.result?.perTest ?? [];
      if (s.status !== 'judged' || !s.judgedAt || !tests.length || !tests.every((t) => t.passed)) {
        continue;
      }
      const key = `${s.userId}|${s.problemId}`;
      const prev = firstSolve.get(key);
      if (!prev || s.judgedAt < prev) firstSolve.set(key, s.judgedAt);
    }
    const byUser = new Map<string, LeaderboardRow>();
    for (const [key, at] of firstSolve) {
      if (since && at < since) continue;
      const [userId, problemId] = key.split('|');
      const points = POINTS[(await this.problems.findById(problemId))?.difficulty ?? ''] ?? 1;
      const row = byUser.get(userId) ?? {
        userId,
        username: (await this.auth.findById(userId))?.username ?? userId.slice(0, 8),
        solved: 0,
        totalScore: 0,
        lastSolvedAt: at,
      };
      row.solved++;
      row.totalScore += points;
      if (at > row.lastSolvedAt) row.lastSolvedAt = at;
      byUser.set(userId, row);
    }
    return [...byUser.values()];
  }
}
