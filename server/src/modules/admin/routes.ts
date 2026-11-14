import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { validateProblem } from '@dsa-portal/core';
import type { Problem, ProblemRepository, TestCase } from '@dsa-portal/core';
import { HttpError, notFound } from '../../lib/http';
import { pool } from '../../db/pool';
// validateProblem (core zod schema) throws ZodError → the central handler answers 400 VALIDATION_ERROR.
import { toApiProblem } from '../problems/routes';
import { authorize } from '../auth/hooks';
import type { AuthStore } from '../auth/store';

// API test cases carry JSON strings (spec `TestCase`); core stores the parsed values.
const ApiTestCase = z.object({ input: z.string(), expected: z.string() });
const ProblemFields = z.object({
  title: z.string(),
  topic: z.string(),
  difficulty: z.string(),
  description: z.string(),
  starterCode: z.string(),
  testCases: z.array(ApiTestCase),
  hints: z.array(z.string()),
  solution: z.string(),
});
const CreateBody = ProblemFields.strict();
const UpdateBody = ProblemFields.partial()
  .extend({ id: z.string().min(1) })
  .strict();
const AddTestCasesBody = z.object({ testCases: z.array(ApiTestCase).min(1) }).strict();

function parseTestCases(list: Array<z.infer<typeof ApiTestCase>>): TestCase[] {
  return list.map((t, i) => {
    try {
      return { input: JSON.parse(t.input), expected: JSON.parse(t.expected) };
    } catch {
      throw new HttpError(
        400,
        'VALIDATION_ERROR',
        `testCases.${i}: input and expected must be JSON strings`
      );
    }
  });
}

/** API body fields → core Problem fields (only those present). */
function toCoreFields(body: Partial<z.infer<typeof ProblemFields>>): Partial<Problem> {
  const { testCases, hints, solution, ...rest } = body;
  return {
    ...(rest as Partial<Problem>),
    ...(testCases && { testCases: parseTestCases(testCases) }),
    ...(hints && { hints: hints.map((content, i) => ({ level: i + 1, content })) }),
    ...(solution !== undefined && { solution: { code: solution } }),
  };
}

export const slugify = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Soft delete by slug or id. Still exported because server/src/index.ts (Person 1's) passes it as
 * `deleteProblem`; the admin route itself uses ProblemRepository.delete (CR-015), which does the same.
 */
export async function unpublishProblem(id: string): Promise<boolean> {
  const res = await pool.query(
    'UPDATE problems SET is_published = false WHERE slug = $1 OR id::text = $1',
    [id]
  );
  return (res.rowCount ?? 0) > 0;
}

export interface AdminRouteOptions {
  auth: AuthStore;
  problems: ProblemRepository;
}

export const adminRoutes: FastifyPluginAsync<AdminRouteOptions> = async (
  app,
  { auth, problems }
) => {
  const guard = { onRequest: app.authenticate, preHandler: authorize(auth, 'admin') };

  app.post('/admin/problems', guard, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const id = slugify(body.title);
    if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'title must contain letters or digits');
    if (await problems.findById(id)) {
      throw new HttpError(409, 'CONFLICT', `A problem with id "${id}" already exists`);
    }
    const problem = validateProblem({ id, ...toCoreFields(body) });
    await problems.save(problem);
    return reply.code(201).send(toApiProblem(problem));
  });

  app.put('/admin/problems', guard, async (req) => {
    const body = UpdateBody.parse(req.body);
    const existing = await problems.findById(body.id);
    if (!existing) throw notFound('Problem');
    // id is the slug and stays fixed; a title change does not rename it.
    const problem = validateProblem({ ...existing, ...toCoreFields(body), id: existing.id });
    await problems.save(problem);
    return toApiProblem(problem);
  });

  app.delete('/admin/problems', guard, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.query);
    if (!(await problems.delete(id))) throw notFound('Problem'); // soft delete (CR-015)
    return reply.code(204).send();
  });

  app.post('/admin/problems/:id/test-cases', guard, async (req) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const body = AddTestCasesBody.parse(req.body);
    const existing = await problems.findById(id);
    if (!existing) throw notFound('Problem');
    const problem = validateProblem({
      ...existing,
      testCases: [...existing.testCases, ...parseTestCases(body.testCases)],
    });
    await problems.save(problem);
    return { testCases: toApiProblem(problem).testCases };
  });
};
