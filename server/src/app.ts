import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { ZodError } from 'zod';
import type { AuditRepository, ProblemRepository, SubmissionRepository } from '@dsa-portal/core';
import { HttpError } from './lib/http';
import { RateLimiter } from './lib/rate-limit';
import { InMemoryProblemRepository } from './modules/problems/in-memory-problem.repository';
import { InMemorySubmissionRepository } from './modules/submissions/in-memory-submission.repository';
import { problemRoutes } from './modules/problems/routes';
import { hintRoutes } from './modules/hints/routes';
import { solutionRoutes } from './modules/solutions/routes';
import { submissionRoutes, type Backpressure, type Quota } from './modules/submissions/routes';
import { queueAdminRoutes } from './modules/submissions/admin-routes';
import { InMemorySubmissionQueue, type SubmissionQueue } from './modules/submissions/queue';
import { InMemoryAuthStore, type AuthStore } from './modules/auth/store';
import { authenticate } from './modules/auth/hooks';
import { authRoutes } from './modules/auth/routes';
import type { LoginThrottle } from './modules/auth/throttle';
import { adminRoutes } from './modules/admin/routes';
import { statsRoutes } from './modules/stats/routes';
import { InMemoryStatsRepository } from './modules/stats/in-memory-stats.repository';
import type { StatsStore } from './modules/stats/stats.service';
import { leaderboardRoutes } from './modules/leaderboard/routes';
import { InMemoryLeaderboardStore, type LeaderboardStore } from './modules/leaderboard/store';
import { dailyRoutes } from './modules/daily/routes';
import { InMemoryDailyChallengeStore, type DailyChallengeStore } from './modules/daily/store';
import { attachRealtime, type EventSource } from './modules/realtime/gateway';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  problems?: ProblemRepository;
  submissions?: SubmissionRepository;
  /** Queue depth + dead-letter actions. Defaults to one over the in-memory submissions. */
  queue?: SubmissionQueue;
  /** Users, sessions and roles (Person 3). */
  auth?: AuthStore;
  stats?: StatsStore;
  /** Admin DELETE /admin/problems; the server passes unpublishProblem until ProblemRepository has delete (CR-015). */
  deleteProblem?: (id: string) => Promise<boolean>;
  throttle?: LoginThrottle;
  backpressure?: Partial<Backpressure>;
  leaderboard?: LeaderboardStore;
  daily?: DailyChallengeStore;
  /** Real-time events for Socket.IO (PostgresEventSource). No gateway without it. */
  events?: EventSource;
  /** Per-user submission quotas (429 QUOTA_EXCEEDED). Env: SUBMIT_QUOTA_PER_MINUTE / _PER_DAY. */
  quota?: Partial<Quota>;
  /** Requests per minute per IP and per signed-in user (429 RATE_LIMITED). Env: RATE_LIMIT_IP_PER_MIN / _USER_PER_MIN. */
  rateLimit?: Partial<{ perIp: number; perUser: number }>;
  /** Browser origins allowed by CORS and Socket.IO. Env: CORS_ORIGINS (comma-separated). */
  corsOrigins?: string[];
  /** Audit trail for submissions (PostgresAuditRepository). Nothing is recorded without it. */
  audit?: AuditRepository;
  /**
   * Mount Person 2's PostgreSQL-only routes: /api/v1/sync/{push,pull,bootstrap}, /health(/live|/ready), /metrics.
   * They use the shared pool directly, so they are loaded lazily and only when the server runs on PostgreSQL.
   */
  postgresRoutes?: boolean;
}

const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;

/** helmet's defaults that matter for a JSON API, without the dependency. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
};

export function buildApp(opts: AppOptions = {}) {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }

  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL ?? 'info' },
    // pino binds reqId to every req.log line; clients/proxies may pass their own x-request-id.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    // The largest legal body is a 100 000-character submission; anything far above that is refused with 413.
    bodyLimit: 512 * 1024,
    // Behind a reverse proxy, req.ip (rate limits, audit) must come from X-Forwarded-For, not the proxy's address.
    trustProxy: process.env.TRUST_PROXY === 'true',
  });

  const submissions = opts.submissions ?? new InMemorySubmissionRepository();
  if (!opts.queue && !(submissions instanceof InMemorySubmissionRepository)) {
    throw new Error(
      'Pass a queue (PostgresSubmissionQueue) together with a non-memory submission repository'
    );
  }
  const problems = opts.problems ?? new InMemoryProblemRepository();
  const auth = opts.auth ?? new InMemoryAuthStore();
  if (!opts.leaderboard && !(submissions instanceof InMemorySubmissionRepository)) {
    throw new Error(
      'Pass a leaderboard store (PostgresLeaderboardStore) together with a non-memory submission repository'
    );
  }
  const deps = {
    problems,
    submissions,
    queue: opts.queue ?? new InMemorySubmissionQueue(submissions as InMemorySubmissionRepository),
    auth,
    leaderboard:
      opts.leaderboard ??
      new InMemoryLeaderboardStore(submissions as InMemorySubmissionRepository, problems, auth),
    daily: opts.daily ?? new InMemoryDailyChallengeStore(problems),
    stats: opts.stats ?? new InMemoryStatsRepository(problems, submissions),
    deleteProblem: opts.deleteProblem ?? (async () => false),
    throttle: opts.throttle,
    backpressure: {
      maxWaiting: Number(process.env.QUEUE_MAX_WAITING) || 500,
      retryAfterS: Number(process.env.QUEUE_RETRY_AFTER_S) || 10,
      ...opts.backpressure,
    },
    quota: {
      perMinute: envInt('SUBMIT_QUOTA_PER_MINUTE', 10),
      perDay: envInt('SUBMIT_QUOTA_PER_DAY', 500),
      ...opts.quota,
    },
    audit: opts.audit,
  };
  const limits = {
    perIp: envInt('RATE_LIMIT_IP_PER_MIN', 300),
    perUser: envInt('RATE_LIMIT_USER_PER_MIN', 120),
    ...opts.rateLimit,
  };
  const ipLimiter = new RateLimiter(limits.perIp);
  const userLimiter = new RateLimiter(limits.perUser);

  // Unset: any origin in development, none in production (native mobile and the CLI send no Origin, so they still work).
  const allowList =
    opts.corsOrigins ??
    process.env.CORS_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  const corsOrigin = allowList?.length ? allowList : process.env.NODE_ENV !== 'production';

  app.register(fastifyCors, { origin: corsOrigin });
  app.register(fastifyJwt, { secret: secret ?? 'dev-secret-change-me' });

  app.decorate('authenticate', authenticate);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    // A route may set its own CSP (the /docs page needs the Redoc script); everything else gets the strict one.
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(k)) reply.header(k, v);
    }
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    let statusCode = 500;
    let error = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    if (err instanceof HttpError) {
      ({ statusCode, code: error, message } = err);
    } else if (err instanceof ZodError) {
      statusCode = 400;
      error = 'VALIDATION_ERROR';
      message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    } else if (err.statusCode && err.statusCode < 500) {
      // Fastify's own 4xx (bad JSON, body too large, wrong content-type).
      statusCode = err.statusCode;
      error = statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message = err.message;
    }
    if (statusCode >= 500) req.log.error({ err }, 'unhandled error');
    reply.code(statusCode).send({
      error,
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      path: req.url.split('?')[0],
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Route ${req.method} ${req.url.split('?')[0]} not found`,
      statusCode: 404,
      timestamp: new Date().toISOString(),
      path: req.url.split('?')[0],
    });
  });

  const tooMany = (
    reply: { header: (k: string, v: string) => unknown },
    retryAfterS: number,
    who: string
  ) => {
    reply.header('retry-after', String(retryAfterS));
    return new HttpError(
      429,
      'RATE_LIMITED',
      `Too many requests from this ${who}; retry in ${retryAfterS}s`
    );
  };

  app.register(
    async (api) => {
      // Per IP before anything else runs (also covers unauthenticated routes like login and register).
      api.addHook('onRequest', async (req, reply) => {
        const wait = ipLimiter.hit(req.ip);
        if (wait) throw tooMany(reply, wait, 'IP');
      });
      // Per user once a route's own onRequest (authenticate) has set req.user: one account behind many IPs is still capped.
      api.addHook('preHandler', async (req, reply) => {
        const sub = (req.user as { sub?: string } | undefined)?.sub;
        const wait = sub ? userLimiter.hit(sub) : 0;
        if (wait) throw tooMany(reply, wait, 'user');
      });
      api.get('/health', async () => ({ status: 'ok', service: 'dsa-portal-server' }));
      await api.register(problemRoutes, deps);
      await api.register(hintRoutes, deps);
      await api.register(solutionRoutes, deps);
      await api.register(submissionRoutes, deps);
      await api.register(queueAdminRoutes, deps);
      await api.register(authRoutes, deps);
      await api.register(adminRoutes, deps);
      await api.register(statsRoutes, deps);
      await api.register(leaderboardRoutes, deps);
      await api.register(dailyRoutes, deps);
      if (opts.postgresRoutes) await api.register((await import('./sync')).syncRoutes);
    },
    { prefix: '/api/v1' }
  );

  if (opts.postgresRoutes) {
    // Container probes and Prometheus scrape the root paths (infra/docker, infra/monitoring).
    app.register(async (root) => {
      await root.register((await import('./health/health.controller')).healthRoutes, {
        prefix: '/health',
      });
      await root.register((await import('./metrics/metrics.controller')).metricsRoutes, {
        prefix: '/metrics',
      });
    });
  }
  serveApiDocs(app);
  if (opts.events) attachRealtime(app, opts.events, corsOrigin);
  return app;
}

/** Same file from src/ and dist/: server/{src,dist}/app → docs/openapi.yaml. Absent in a slim image → no /docs. */
const SPEC_PATH = join(__dirname, '../../docs/openapi.yaml');
const REDOC = 'https://cdn.redoc.ly/redoc/v2.1.5/bundles/redoc.standalone.js'; // pinned version

/** GET /docs (Redoc, rendered from the same openapi.yaml the contract test checks) and GET /docs/openapi.yaml. */
function serveApiDocs(app: FastifyInstance) {
  if (!existsSync(SPEC_PATH)) return;
  const spec = readFileSync(SPEC_PATH, 'utf8');
  app.get('/docs/openapi.yaml', async (_req, reply) =>
    reply.type('application/yaml; charset=utf-8').send(spec)
  );
  app.get('/docs', async (_req, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header(
        'content-security-policy',
        `default-src 'none'; script-src ${new URL(REDOC).origin}; style-src 'unsafe-inline'; img-src 'self' data:; ` +
          "font-src 'self' data:; connect-src 'self'; worker-src blob:; frame-ancestors 'none'"
      )
      .send(
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>DSA Portal API</title>' +
          '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
          `<body><redoc spec-url="/docs/openapi.yaml"></redoc><script src="${REDOC}"></script></body></html>`
      )
  );
}
