import type { PoolClient } from 'pg';
import type { Difficulty, StatsRepository, Submission } from '@dsa-portal/core';
// The file, not the repositories index: submission.repository imports this module (no import cycle).
import { PostgresStatsRepository } from '../../db/repositories/stats.repository';
import { pool } from '../../db/pool';

export interface StreakStat {
  currentStreak: number;
  longestStreak: number;
  lastSolvedAt: string | null;
}
export interface DifficultyStat {
  difficulty: Difficulty;
  attempted: number;
  solved: number;
}

/** StatsRepository plus what the stats API needs for streaks and the difficulty chart. */
export interface StatsStore extends StatsRepository {
  /** Instants at which the user first solved each problem (one per solved problem). */
  getFirstSolves(userId: string): Promise<Date[]>;
  getDifficultyStats(userId: string): Promise<DifficultyStat[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Streak rules: a day counts when the user solves a problem for the first time that day.
 * Days are UTC calendar days. The current streak survives until the end of the next UTC day,
 * so it is still shown on a day the user hasn't solved anything yet.
 */
export function computeStreak(firstSolves: Date[], now = new Date()): StreakStat {
  if (firstSolves.length === 0) return { currentStreak: 0, longestStreak: 0, lastSolvedAt: null };
  const days = [...new Set(firstSolves.map(utcDay))].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const last = days[days.length - 1];
  const current = utcDay(now) - last <= 1 ? run : 0;
  const lastSolvedAt = new Date(Math.max(...firstSolves.map((d) => d.getTime()))).toISOString();
  return { currentStreak: current, longestStreak: longest, lastSolvedAt };
}

/**
 * Maintained counters: call inside the transaction that stores the judged result, so stats can
 * never disagree with submissions. The single upsert is safe under concurrent submissions
 * (the unique (user_id, problem_id) row is locked by ON CONFLICT DO UPDATE).
 * PostgresSubmissionRepository.save() calls it (CR-017).
 */
export async function updateStatsOnSubmission(
  tx: PoolClient,
  submission: Submission
): Promise<void> {
  if (submission.status !== 'judged') return;
  const perTest = submission.result?.perTest ?? [];
  const solved = perTest.length > 0 && perTest.every((t) => t.passed);
  await tx.query(
    `INSERT INTO user_problem_stats (user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at)
     SELECT $1::uuid, p.id, 1, $3, CASE WHEN $3 THEN now() END, now()
     FROM problems p WHERE p.slug = $2 OR p.id::text = $2
     ON CONFLICT (user_id, problem_id) DO UPDATE SET
       attempts = user_problem_stats.attempts + 1,
       solved = user_problem_stats.solved OR EXCLUDED.solved,
       first_solved_at = COALESCE(user_problem_stats.first_solved_at, EXCLUDED.first_solved_at),
       last_attempted_at = now()`,
    [submission.userId, submission.problemId, solved]
  );
}

/** Person 2's repository plus the two reads above, on the same user_problem_stats counters. */
export class PostgresStatsStore extends PostgresStatsRepository implements StatsStore {
  async getFirstSolves(userId: string) {
    const res = await pool.query<{ at: Date }>(
      `SELECT first_solved_at AS at FROM user_problem_stats
       WHERE user_id = $1::uuid AND solved AND first_solved_at IS NOT NULL`,
      [userId]
    );
    return res.rows.map((r) => r.at);
  }

  async getDifficultyStats(userId: string) {
    const res = await pool.query<DifficultyStat>(
      `SELECT p.difficulty, COUNT(*)::int AS attempted, COUNT(*) FILTER (WHERE ups.solved)::int AS solved
       FROM user_problem_stats ups JOIN problems p ON p.id = ups.problem_id
       WHERE ups.user_id = $1::uuid GROUP BY p.difficulty ORDER BY p.difficulty`,
      [userId]
    );
    return res.rows;
  }
}
