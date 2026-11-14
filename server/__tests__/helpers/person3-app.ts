import './fast-bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { ProblemRepository, SubmissionRepository } from '@dsa-portal/core';
import { statsServiceStub } from '@dsa-portal/workers';
import { buildApp } from '../../src/app';
import { InMemoryProblemRepository } from '../../src/modules/problems/in-memory-problem.repository';
import { InMemorySubmissionRepository } from '../../src/modules/submissions/in-memory-submission.repository';
import { InMemoryAuthStore, type AuthStore } from '../../src/modules/auth/store';
import { LoginThrottle } from '../../src/modules/auth/throttle';
import { InMemoryStatsRepository } from '../../src/modules/stats/in-memory-stats.repository';
import type { StatsStore } from '../../src/modules/stats/stats.service';

const raw = JSON.stringify(
  parse(fs.readFileSync(path.join(__dirname, '../../../docs/openapi.yaml'), 'utf8'))
);
const spec = JSON.parse(raw.split('"#/components/').join('"spec#/components/'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'spec', components: spec.components });

/** Throws if the body doesn't match the documented response (undocumented errors must use `Error`). */
export function assertMatchesSpec(method: string, url: string, status: number, body: unknown) {
  const op = spec.paths[url]?.[method];
  if (!op) return; // route not in the spec yet (CR-016); shape is checked by the test itself
  let res = op.responses[String(status)];
  if (res?.$ref) res = spec.components.responses[res.$ref.split('/').pop()];
  const schema =
    res?.content?.['application/json']?.schema ??
    (status >= 400 ? { $ref: 'spec#/components/schemas/Error' } : null);
  if (!schema) {
    if (body !== undefined) throw new Error(`${method} ${url} ${status}: body not documented`);
    return;
  }
  const validate = ajv.compile(schema);
  if (!validate(body)) {
    throw new Error(`${method} ${url} ${status}: ${ajv.errorsText(validate.errors)}`);
  }
}

/**
 * The real server app (Person 3's modules are wired in app.ts since CR-010) plus a spec-checking `call`.
 * Pass Postgres stores to run the same routes against a real database.
 */
export function buildPerson3App(
  opts: {
    auth?: AuthStore;
    problems?: ProblemRepository;
    submissions?: SubmissionRepository;
    stats?: StatsStore;
    throttle?: LoginThrottle;
  } = {}
) {
  const problems = opts.problems ?? new InMemoryProblemRepository();
  const submissions = opts.submissions ?? new InMemorySubmissionRepository();
  const auth = opts.auth ?? new InMemoryAuthStore();
  const stats = opts.stats ?? new InMemoryStatsRepository(problems, submissions);
  const app = buildApp({
    logger: false,
    problems,
    submissions,
    auth,
    stats,
    throttle: opts.throttle,
  });

  type Opts = {
    payload?: object;
    headers?: Record<string, string>;
    query?: Record<string, string>;
  };
  /** inject + spec check. `specPath` is the documented path, `url` overrides the real one. */
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    specPath: string,
    o: Opts & { url?: string } = {}
  ) => {
    const res = await app.inject({
      method,
      url: o.url ?? `/api/v1${specPath}`,
      payload: o.payload,
      headers: o.headers,
      query: o.query,
    });
    assertMatchesSpec(
      method.toLowerCase(),
      `/api/v1${specPath}`,
      res.statusCode,
      res.body ? res.json() : undefined
    );
    return res;
  };
  return {
    app,
    call,
    auth,
    problems,
    submissions,
    deps: { problems, submissions, stats: statsServiceStub },
  };
}

export const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie']).split(';')[0];
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
