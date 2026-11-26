import { timingSafeEqual } from 'crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { MetricsService } from './metrics.service';

/** Constant-time check of `Authorization: Bearer <METRICS_TOKEN>`. */
function hasToken(header: string | undefined, token: string): boolean {
  const got = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const metricsRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const metricsService = MetricsService.getInstance();

  fastify.get('/', async (request, reply) => {
    // Hosts with no nginx in front (Render) set METRICS_TOKEN so the internals are not public.
    const token = process.env.METRICS_TOKEN;
    if (token && !hasToken(request.headers.authorization, token)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const exposition = metricsService.renderPrometheusMetrics();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .status(200)
      .send(exposition);
  });
};
