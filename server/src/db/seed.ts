import { validateProblem } from '@dsa-portal/core';
import { pool, closePool } from './pool';
import { PostgresProblemRepository } from './repositories/problem.repository';
import { PostgresUserRepository } from './repositories/user.repository';
import { SEED_PROBLEMS } from './seeds/problems-data';

export async function seedDatabase(): Promise<{
  problemsCount: number;
  usersCount: number;
  dailyChallengeSet: boolean;
}> {
  console.log('[Seed] Starting database seed...');

  const problemRepo = new PostgresProblemRepository();
  const userRepo = new PostgresUserRepository();

  // 1. Validate all seed problems with Zod schema before inserting
  console.log(`[Seed] Validating ${SEED_PROBLEMS.length} problems against Zod schema...`);
  for (const problem of SEED_PROBLEMS) {
    try {
      validateProblem(problem);
    } catch (err) {
      console.error(`[Seed] Validation failed for problem: ${problem.id}`, err);
      throw err;
    }
  }
  console.log('[Seed] All seed problems passed Zod validation.');

  // 2. Idempotent upsert of all problems
  console.log('[Seed] Upserting problems into database...');
  for (const problem of SEED_PROBLEMS) {
    await problemRepo.save(problem);
  }
  console.log(`[Seed] Successfully seeded ${SEED_PROBLEMS.length} problems across 8 topics.`);

  // 3. Seed Default Users
  console.log('[Seed] Seeding default users (admin, student)...');
  const devPasswordHash = '$2a$10$iBVruH6tb4eMv2wF.RPFT.XkkhjjPIQ/wpSU2mR.2VuHIDY8E1T2y'; // bcrypt hash for password123 (CR-012)

  await userRepo.save({
    id: '00000000-0000-0000-0000-000000000001',
    username: 'admin',
    email: 'admin@dsa.portal',
    role: 'admin',
    passwordHash: devPasswordHash,
  });

  await userRepo.save({
    id: '00000000-0000-0000-0000-000000000002',
    username: 'student',
    email: 'student@dsa.portal',
    role: 'user',
    passwordHash: devPasswordHash,
  });
  // save() never overwrites a password on conflict, so reset the two dev accounts explicitly (CR-012).
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = ANY($2::uuid[])', [
    devPasswordHash,
    ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
  ]);

  // 4. Set Today's Daily Challenge (idempotent upsert on CURRENT_DATE)
  console.log('[Seed] Setting today’s daily challenge...');
  const firstProblem = SEED_PROBLEMS[0];
  let dailyChallengeSet = false;

  if (firstProblem) {
    const probRes = await pool.query<{ id: string }>(
      'SELECT id FROM problems WHERE slug = $1 LIMIT 1',
      [firstProblem.id]
    );

    if (probRes.rows.length > 0) {
      await pool.query(
        `INSERT INTO daily_challenges (challenge_date, problem_id)
         VALUES (CURRENT_DATE, $1)
         ON CONFLICT (challenge_date) DO UPDATE SET problem_id = EXCLUDED.problem_id;`,
        [probRes.rows[0].id]
      );
      dailyChallengeSet = true;
    }
  }

  console.log('[Seed] Database seed completed successfully!');
  return {
    problemsCount: SEED_PROBLEMS.length,
    usersCount: 2,
    dailyChallengeSet,
  };
}

/**
 * Seeds only a database with no problems yet (first start of a fresh deployment); null when it skipped.
 * Hosts without a shell (Render free plan) run this on every start.
 */
export async function seedIfEmpty(): Promise<Awaited<ReturnType<typeof seedDatabase>> | null> {
  const { rows } = await pool.query<{ has: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM problems) AS has'
  );
  if (rows[0].has) {
    console.log('[Seed] Problems already present, skipping seed.');
    return null;
  }
  return seedDatabase();
}

// Direct execution: `node seed.js` always seeds (idempotent upserts); `--if-empty` only on a fresh database.
if (require.main === module) {
  (process.argv.includes('--if-empty') ? seedIfEmpty() : seedDatabase())
    .then((result) => {
      console.log('Seed summary:', result);
      return closePool().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Seed execution failed:', err);
      return closePool().then(() => process.exit(1));
    });
}
