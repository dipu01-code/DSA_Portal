import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decodeCursor, keysetPage } from '../../lib/http';
import { PageQuery } from '../problems/routes';
import type { LeaderboardRow, LeaderboardStore } from './store';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Most problems solved first; on a tie, whoever got there earlier; then user id so the order is total. */
export function rankRows(rows: LeaderboardRow[]) {
  return [...rows]
    .sort(
      (a, b) =>
        b.solved - a.solved ||
        a.lastSolvedAt.getTime() - b.lastSolvedAt.getTime() ||
        a.userId.localeCompare(b.userId)
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export const leaderboardRoutes: FastifyPluginAsync<{ leaderboard: LeaderboardStore }> = async (
  app,
  { leaderboard }
) => {
  // Public, like the spec says: no auth hook.
  app.get('/leaderboard', async (req) => {
    const q = z
      .object({ ...PageQuery, period: z.enum(['week', 'all']).default('all') })
      .parse(req.query);
    const since = q.period === 'week' ? new Date(Date.now() - WEEK_MS) : null;
    const ranked = rankRows(await leaderboard.rows(since));
    return keysetPage(
      ranked,
      (r) => r.userId,
      decodeCursor(q.cursor),
      q.limit,
      ({ userId, username, solved, totalScore, rank }) => ({
        userId,
        username,
        solved,
        totalScore,
        rank,
      })
    );
  });
};
