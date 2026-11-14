/**
 * Throwaway API for the web e2e tests: the real server app (auth, problems, submissions, stats)
 * on in-memory stores with the 40 seed problems, plus a stand-in for the BullMQ worker that
 * judges queued submissions with core's sandbox. Run with tsx; PORT defaults to 3999.
 */
process.env.BCRYPT_COST ??= '4';

async function main() {
  const { buildApp } = await import('../../server/src/app');
  const { InMemorySubmissionRepository } =
    await import('../../server/src/modules/submissions/in-memory-submission.repository');
  const { InMemoryProblemRepository } =
    await import('../../server/src/modules/problems/in-memory-problem.repository');
  const { submitCodeSandboxAsync } = await import('../../core/src/sandbox');
  const { SEED_PROBLEMS } = await import('../../server/src/db/seeds/problems-data');

  const submissions = new InMemorySubmissionRepository();
  const app = buildApp({
    logger: false,
    submissions,
    problems: new InMemoryProblemRepository(SEED_PROBLEMS),
  });
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      for (const s of submissions.all().filter((x) => x.status === 'queued')) {
        const result = await submitCodeSandboxAsync(
          SEED_PROBLEMS.find((p) => p.id === s.problemId)!,
          s.code
        );
        await submissions.save({ ...s, status: 'judged', result, judgedAt: new Date() });
      }
    } finally {
      busy = false;
    }
  }, 200);
  await app.listen({ port: Number(process.env.PORT ?? 3999), host: '127.0.0.1' });
}
void main();
