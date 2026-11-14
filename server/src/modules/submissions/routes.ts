import { createHash, randomUUID } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type {
  AuditRepository,
  ProblemRepository,
  Submission,
  SubmissionRepository,
} from '@dsa-portal/core';
import { decodeCursor, HttpError, keysetPage, notFound } from '../../lib/http';
import { findProblemOr404, IdParams, PageQuery } from '../problems/routes';
import type { SubmissionQueue } from './queue';

const SubmissionCreate = z.object({
  problemId: z.string().min(1),
  // PostgreSQL text cannot hold NUL; rejecting it here turns a 500 into a clear 400.
  code: z
    .string()
    .min(1)
    .max(100_000)
    .refine((c) => !c.includes('\0'), 'must not contain NUL characters'),
});
const IdempotencyKey = z.string().min(1).max(128).optional();

/** Core Submission → OpenAPI Submission. */
export function toApiSubmission(s: Submission) {
  const perTest = s.result?.perTest ?? [];
  return {
    id: s.id,
    problemId: s.problemId,
    userId: s.userId,
    status: s.status,
    passed: perTest.filter((t) => t.passed).length,
    total: perTest.length,
    results: perTest.map((t, i) => ({
      testCaseIndex: i,
      passed: t.passed,
      actual: JSON.stringify(t.actual),
      expected: JSON.stringify(t.expected),
    })),
    createdAt: s.createdAt.toISOString(),
    judgedAt: s.judgedAt?.toISOString() ?? null,
  };
}

// Newest first; id breaks ties so the cursor key is unique.
const sortKey = (s: Submission) => `${s.createdAt.toISOString()}|${s.id}`;

export interface Backpressure {
  /** 429 once this many submissions are waiting. */
  maxWaiting: number;
  retryAfterS: number;
}

/** Per-user execution quotas, counted in PostgreSQL so they hold across API instances. */
export interface Quota {
  perMinute: number;
  perDay: number;
}

export const submissionRoutes: FastifyPluginAsync<{
  problems: ProblemRepository;
  submissions: SubmissionRepository;
  queue: SubmissionQueue;
  backpressure: Backpressure;
  quota: Quota;
  audit?: AuditRepository;
}> = async (app, { problems, submissions, queue, backpressure, quota, audit }) => {
  app.post('/submissions', { onRequest: app.authenticate }, async (req, reply) => {
    const body = SubmissionCreate.parse(req.body);
    const key = IdempotencyKey.parse(req.headers['idempotency-key']);
    const userId = req.user.sub;

    // A retry with the same key returns the first submission instead of judging twice.
    // Returns data, never `reply`: Fastify's reply is thenable, so awaiting it would swallow it.
    const findReplay = async () => {
      const existing = key ? await submissions.findByIdempotencyKey(userId, key) : null;
      if (existing && (existing.problemId !== body.problemId || existing.code !== body.code)) {
        throw new HttpError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used with a different request body'
        );
      }
      return existing;
    };
    const accepted = (s: Submission) =>
      reply.code(202).send({ submissionId: s.id, status: s.status });

    const replay = await findReplay();
    if (replay) return accepted(replay);

    // Quotas (a replay above uses none): the user's n-th newest submission inside the window says when a slot frees up.
    for (const [limit, windowMs, label] of [
      [quota.perMinute, 60_000, 'minute'],
      [quota.perDay, 86_400_000, 'day'],
    ] as const) {
      const nth = await queue.nthNewestSince(userId, limit, new Date(Date.now() - windowMs));
      if (nth) {
        const retryAfterS = Math.max(1, Math.ceil((nth.getTime() + windowMs - Date.now()) / 1000));
        reply.header('retry-after', String(retryAfterS));
        throw new HttpError(
          429,
          'QUOTA_EXCEEDED',
          `Submission quota of ${limit} per ${label} reached; retry in ${retryAfterS}s`
        );
      }
    }

    // Backpressure: refuse new work while the workers are far behind (a replay above adds none).
    if ((await queue.waitingCount()) >= backpressure.maxWaiting) {
      reply.header('retry-after', String(backpressure.retryAfterS));
      throw new HttpError(
        429,
        'QUEUE_FULL',
        `Too many submissions waiting; retry in ${backpressure.retryAfterS}s`
      );
    }

    const problem = await findProblemOr404(problems, body.problemId);
    const submission: Submission = {
      id: randomUUID(),
      problemId: problem.id,
      userId,
      code: body.code,
      status: 'queued',
      createdAt: new Date(),
      idempotencyKey: key,
    };
    try {
      // The insert also wakes a worker (pg_notify trigger, migration 002).
      await submissions.save(submission);
    } catch (err) {
      // Two concurrent retries with one key: the unique index lets only one insert win.
      if (key && (err as { code?: string }).code === '23505') {
        const raced = await findReplay();
        if (raced) return accepted(raced);
      }
      throw err;
    }
    req.log.info({ submissionId: submission.id, problemId: problem.id }, 'submission queued');
    // Who submitted what, when, from where. The code itself is in the submission row; the hash proves it is unchanged.
    const entry = {
      actorId: userId,
      action: 'submission.create',
      entityType: 'submission',
      entityId: submission.id,
      newValue: {
        problemId: problem.id,
        codeSha256: createHash('sha256').update(body.code).digest('hex'),
        codeLength: body.code.length,
      },
      ipAddress: req.ip,
    };
    // The submission is already queued, so a failed audit insert must not turn into an error for the user; the log line keeps the record.
    await audit
      ?.log(entry)
      .catch((err) => req.log.error({ err, audit: entry }, 'audit log write failed'));
    return accepted(submission);
  });

  app.get('/submissions', { onRequest: app.authenticate }, async (req) => {
    const q = z.object({ ...PageQuery, problemId: z.string().optional() }).parse(req.query);
    const rows = (await submissions.findByUser(req.user.sub))
      .filter((s) => !q.problemId || s.problemId === q.problemId)
      .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    return keysetPage(rows, sortKey, decodeCursor(q.cursor), q.limit, toApiSubmission);
  });

  app.get('/submissions/:id', { onRequest: app.authenticate }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const submission = await submissions.findById(id);
    // Someone else's submission looks the same as a missing one: no id probing.
    if (!submission || submission.userId !== req.user.sub) throw notFound('Submission');
    return toApiSubmission(submission);
  });
};
