import { createHash } from 'crypto';
import type { ProblemRepository } from '@dsa-portal/core';
import { pool } from '../../db/pool';

/** UTC calendar day, YYYY-MM-DD. */
export const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);

/** Same date + same problem list → same problem, on every server and worker. */
export function pickDaily(date: string, problemIds: string[]): string | null {
  if (!problemIds.length) return null;
  const sorted = [...problemIds].sort();
  const n = createHash('sha256').update(date).digest().readUInt32BE(0);
  return sorted[n % sorted.length];
}

export interface DailyChallengeStore {
  /** Today's (or `date`'s) problem id, choosing and saving it on first use. Null if there are no problems. */
  getOrCreate(date: string): Promise<string | null>;
}

/** Saved in daily_challenges; the insert fires daily:new (migration 005), so it is announced once. */
export class PostgresDailyChallengeStore implements DailyChallengeStore {
  private async saved(date: string) {
    const { rows } = await pool.query<{ slug: string }>(
      `SELECT p.slug FROM daily_challenges d JOIN problems p ON p.id = d.problem_id WHERE d.challenge_date = $1`,
      [date]
    );
    return rows[0]?.slug ?? null;
  }

  async getOrCreate(date: string) {
    const existing = await this.saved(date);
    if (existing) return existing;
    const { rows } = await pool.query<{ slug: string }>(
      `SELECT slug FROM problems WHERE is_published ORDER BY slug`
    );
    const slug = pickDaily(
      date,
      rows.map((r) => r.slug)
    );
    if (!slug) return null;
    await pool.query(
      `INSERT INTO daily_challenges (challenge_date, problem_id)
       SELECT $1, id FROM problems WHERE slug = $2
       ON CONFLICT (challenge_date) DO NOTHING`,
      [date, slug]
    );
    // Re-read: a concurrent caller may have inserted first (same pick, unless the problem list changed meanwhile).
    return (await this.saved(date)) ?? slug;
  }
}

/** No database: the pick is deterministic, so nothing needs saving. */
export class InMemoryDailyChallengeStore implements DailyChallengeStore {
  constructor(private problems: ProblemRepository) {}
  async getOrCreate(date: string) {
    return pickDaily(
      date,
      (await this.problems.findAll()).map((p) => p.id)
    );
  }
}
