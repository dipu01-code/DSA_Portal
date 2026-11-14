import type { FastifyPluginAsync } from 'fastify';
import { computeStreak, isoDay, type StatsStore } from './stats.service';

export const statsRoutes: FastifyPluginAsync<{ stats: StatsStore }> = async (app, { stats }) => {
  const auth = { onRequest: app.authenticate };

  app.get('/stats/me', auth, async (req) => {
    const id = req.user.sub;
    const [summary, topics, difficulties, firstSolves] = await Promise.all([
      stats.getUserStats(id),
      stats.getTopicStats(id),
      stats.getDifficultyStats(id),
      stats.getFirstSolves(id),
    ]);
    return {
      attempted: summary.attempted,
      solved: summary.solved,
      totalProblems: summary.totalProblems,
      streak: computeStreak(firstSolves),
      topics,
      difficulties, // CR-016: additive field for the difficulty chart
    };
  });

  app.get('/stats/me/topics', auth, async (req) => ({
    topics: await stats.getTopicStats(req.user.sub),
  }));

  // CR-016: not in openapi.yaml yet. `days` (UTC, ascending) feeds the streak calendar.
  app.get('/stats/me/streak', auth, async (req) => {
    const firstSolves = await stats.getFirstSolves(req.user.sub);
    return { ...computeStreak(firstSolves), days: [...new Set(firstSolves.map(isoDay))].sort() };
  });
};
