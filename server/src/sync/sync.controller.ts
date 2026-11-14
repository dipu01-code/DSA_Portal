import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { SyncService, SyncCursorExpiredError } from './sync.service';
import type { SyncPushRequest, SyncPullRequest } from '@dsa-portal/core';

export const syncRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const syncService = new SyncService();

  // Middleware ensuring user is authenticated
  const requireAuth = async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'JWT token required' });
    }
  };

  /**
   * POST /sync/push
   * Batched, idempotent ingestion of client mutation operations
   */
  app.post<{ Body: SyncPushRequest }>(
    '/sync/push',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      const userId = req.user?.sub; // access token payload is { sub }
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const response = await syncService.push(userId, req.body);
        return reply.status(200).send(response);
      } catch (err: any) {
        req.log.error(err, 'Failed to process sync push batch');
        return reply.status(400).send({
          error: 'BAD_REQUEST',
          message: err?.message || 'Sync push failed',
        });
      }
    }
  );

  /**
   * GET /sync/pull
   * Incremental pull using monotonically increasing server_seq cursor
   */
  app.get<{ Querystring: SyncPullRequest }>(
    '/sync/pull',
    { onRequest: [requireAuth] },
    async (req, reply) => {
      const userId = req.user?.sub; // access token payload is { sub }
      if (!userId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      try {
        const response = await syncService.pull(userId, req.query);
        return reply.status(200).send(response);
      } catch (err: any) {
        if (err instanceof SyncCursorExpiredError || err.code === 'SYNC_CURSOR_EXPIRED') {
          return reply.status(410).send({
            error: 'SYNC_CURSOR_EXPIRED',
            message: 'Cursor is older than tombstone retention window. Full bootstrap required.',
          });
        }
        req.log.error(err, 'Failed to process sync pull');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: err?.message || 'Sync pull failed',
        });
      }
    }
  );

  /**
   * GET /sync/bootstrap
   * Full snapshot recovery
   */
  app.get('/sync/bootstrap', { onRequest: [requireAuth] }, async (req, reply) => {
    const userId = req.user?.sub; // access token payload is { sub }
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const response = await syncService.bootstrap(userId);
      return reply.status(200).send(response);
    } catch (err: any) {
      req.log.error(err, 'Failed to generate sync bootstrap snapshot');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: err?.message || 'Sync bootstrap failed',
      });
    }
  });
};
