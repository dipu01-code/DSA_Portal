import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HintService } from '@dsa-portal/core';
import type { ProblemRepository } from '@dsa-portal/core';
import { findProblemOr404, IdParams } from '../problems/routes';

const hintService = new HintService();

export const hintRoutes: FastifyPluginAsync<{ problems: ProblemRepository }> = async (
  app,
  { problems }
) => {
  app.get('/problems/:id/hints', { onRequest: app.authenticate }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const { upto } = z.object({ upto: z.coerce.number().int().min(0).optional() }).parse(req.query);
    const problem = await findProblemOr404(problems, id);
    const hints = hintService
      .getHintsUpTo(problem, upto ?? Number.MAX_SAFE_INTEGER)
      .sort((a, b) => a.level - b.level);
    return { hints: hints.map((h) => h.content) };
  });
};
