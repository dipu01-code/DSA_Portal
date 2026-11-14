import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { HealthService } from './health.service';

export const healthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const healthService = new HealthService();

  // Liveness probe (cheap, no external dependencies)
  fastify.get('/live', async (_request, reply) => {
    const live = await healthService.checkLiveness();
    return reply.status(200).send(live);
  });

  // Readiness probe (verifies database pool)
  fastify.get('/ready', async (_request, reply) => {
    const health = await healthService.checkReadiness();
    const statusCode = health.status === 'down' ? 503 : 200;
    return reply.status(statusCode).send(health);
  });

  // Alias /health to /ready for standard container orchestration
  fastify.get('/', async (_request, reply) => {
    const health = await healthService.checkReadiness();
    const statusCode = health.status === 'down' ? 503 : 200;
    return reply.status(statusCode).send(health);
  });
};
