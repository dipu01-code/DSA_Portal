import type { FastifyPluginAsync } from 'fastify';
import type { ProblemRepository } from '@dsa-portal/core';
import { notFound } from '../../lib/http';
import { findProblemOr404, toApiProblem } from '../problems/routes';
import { utcDate, type DailyChallengeStore } from './store';

export const dailyRoutes: FastifyPluginAsync<{
  daily: DailyChallengeStore;
  problems: ProblemRepository;
}> = async (app, { daily, problems }) => {
  app.get('/daily-challenge', { onRequest: app.authenticate }, async () => {
    const date = utcDate();
    const problemId = await daily.getOrCreate(date);
    if (!problemId) throw notFound('Daily challenge');
    return { date, problemId, problem: toApiProblem(await findProblemOr404(problems, problemId)) };
  });
};
