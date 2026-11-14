import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decodeCursor, encodeCursor, HttpError, notFound } from '../../lib/http';
import { authorize } from '../auth/hooks';
import type { AuthStore } from '../auth/store';
import { IdParams, PageQuery } from '../problems/routes';
import type { FailedJob, SubmissionQueue } from './queue';

const toApiFailedJob = (j: FailedJob) => ({
  id: j.id,
  problemId: j.problemId,
  userId: j.userId,
  attempts: j.attempts,
  lastError: j.lastError,
  createdAt: j.createdAt.toISOString(),
  failedAt: j.failedAt?.toISOString() ?? null,
});

/** Dead-letter list for admins: see why jobs failed and put them back on the queue. */
export const queueAdminRoutes: FastifyPluginAsync<{
  queue: SubmissionQueue;
  auth: AuthStore;
}> = async (app, { queue, auth }) => {
  const guard = { onRequest: app.authenticate, preHandler: authorize(auth, 'admin') };

  app.get('/admin/queue/failed', guard, async (req) => {
    const q = z.object(PageQuery).parse(req.query);
    const cursor = decodeCursor(q.cursor);
    let after: { failedAt: string; id: string } | undefined;
    if (cursor) {
      const [failedAt, id] = cursor.split('|');
      if (!z.string().uuid().safeParse(id).success || Number.isNaN(Date.parse(failedAt))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'cursor is invalid');
      }
      after = { failedAt, id };
    }
    const rows = await queue.listFailed(q.limit + 1, after); // one extra row tells us if there is a next page
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      data: page.map(toApiFailedJob),
      nextCursor:
        rows.length > q.limit && last.failedAt
          ? encodeCursor(`${last.failedAt.toISOString()}|${last.id}`)
          : null,
    };
  });

  app.post('/admin/queue/failed/:id/requeue', guard, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await queue.requeue(id))) throw notFound('Failed submission');
    return reply.code(202).send({ submissionId: id, status: 'queued' });
  });
};
