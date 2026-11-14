import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { MetricsService } from './metrics.service';

export const metricsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const metricsService = MetricsService.getInstance();

  fastify.get('/', async (_request, reply) => {
    const exposition = metricsService.renderPrometheusMetrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(exposition);
  });
};
