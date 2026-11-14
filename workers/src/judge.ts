import { submitCodeSandboxAsync } from '@dsa-portal/core';
import type { ProblemRepository, Submission, SubmissionRepository } from '@dsa-portal/core';

/** Hook for Person 3's stats service (streaks, caches). */
export interface StatsService {
  onSubmissionJudged(submission: Submission): Promise<void>;
}

// TEMP STUB (Day 5): replace with Person 3's stats service once merged.
// user_problem_stats is already updated by PostgresSubmissionRepository.save().
export const statsServiceStub: StatsService = {
  async onSubmissionJudged() {},
};

export interface JudgeDeps {
  problems: ProblemRepository;
  submissions: SubmissionRepository;
  stats: StatsService;
}

/** Thrown when another worker took the job over (our lease expired), so our result must be dropped. */
export class LeaseLostError extends Error {}

/**
 * Judges one submission and saves the result. Safe to call twice for the same id:
 * an already finished submission is returned unchanged (no double stats update).
 * `ownsJob` (queue workers) is checked right before saving, so a zombie worker never saves twice.
 */
export async function judgeSubmission(
  id: string,
  deps: JudgeDeps,
  ownsJob?: () => Promise<boolean>
): Promise<Submission> {
  const submission = await deps.submissions.findById(id);
  if (!submission) throw new Error(`Submission ${id} not found`);
  if (submission.status === 'judged' || submission.status === 'failed') return submission;

  const problem = await deps.problems.findById(submission.problemId);
  if (problem) {
    submission.result = await submitCodeSandboxAsync(problem, submission.code);
    submission.status = 'judged';
  } else {
    submission.status = 'failed';
  }
  submission.judgedAt = new Date();
  if (ownsJob && !(await ownsJob())) {
    throw new LeaseLostError(`Lease on ${id} lost; result dropped`);
  }
  await deps.submissions.save(submission);
  if (submission.status === 'judged') await deps.stats.onSubmissionJudged(submission);
  return submission;
}
