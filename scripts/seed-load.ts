import { pool, closePool } from '../server/src/db/pool';

/**
 * High-performance realistic load generator:
 * Generates ~10,000 users, ~100,000 submissions, aggregated user_problem_stats,
 * and realistic sync_op_log entries.
 *
 * Distribution Characteristics:
 * - 80/20 Pareto distribution: Top 20% power users generate ~80% of submissions.
 * - Zipfian problem popularity: Easy problems receive ~5-10x more submissions than Hard problems.
 * - Difficulty-dependent pass rates: Easy (~70%), Medium (~45%), Hard (~25%).
 * - Status distribution: 92% judged, 5% failed, 3% queued/running.
 * - Temporal distribution: Spread across past 180 days with realistic activity peaks.
 */

const TARGET_USERS = 10000;
const TARGET_SUBMISSIONS = 100000;
const BATCH_SIZE = 5000;

// Deterministic Pseudo-Random Number Generator (PRNG) for reproducibility
let seed = 42;
function random(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function randomInt(min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(random() * arr.length)];
}

// Generate power-law index for user selection (Pareto 80/20)
function getParetoUserIndex(totalUsers: number): number {
  // P(X <= x) = 1 - (1 - x)^alpha; using alpha ~ 0.3 for heavy 80/20 skew
  const u = random();
  const index = Math.floor(totalUsers * Math.pow(u, 3.5));
  return Math.min(index, totalUsers - 1);
}

// UUID v4 generator
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function runLoadSeeder(): Promise<{
  usersCount: number;
  submissionsCount: number;
  statsCount: number;
  syncOpsCount: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  console.log(`[Seed-Load] Starting realistic load generation...`);
  console.log(
    `[Seed-Load] Targets: ~${TARGET_USERS.toLocaleString()} users, ~${TARGET_SUBMISSIONS.toLocaleString()} submissions`
  );

  const client = await pool.connect();

  try {
    // 1. Fetch available problems
    const problemsRes = await client.query<{
      id: string;
      slug: string;
      difficulty: string;
      topic: string;
    }>('SELECT id, slug, difficulty, topic FROM problems ORDER BY created_at ASC');

    if (problemsRes.rows.length === 0) {
      throw new Error('No problems found in database! Run "npm run db:seed" first.');
    }

    const problems = problemsRes.rows;
    console.log(`[Seed-Load] Found ${problems.length} problems across topics.`);

    // Assign popularity weights: Easy (10), Medium (4), Hard (1)
    const weightedProblems: string[] = [];
    for (const p of problems) {
      const weight = p.difficulty === 'Easy' ? 10 : p.difficulty === 'Medium' ? 4 : 1;
      for (let w = 0; w < weight; w++) {
        weightedProblems.push(p.id);
      }
    }

    // Problem lookup by id
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    // 2. Generate and bulk insert 10,000 Users
    console.log(`[Seed-Load] Generating ${TARGET_USERS} users...`);
    const userIds: string[] = [];
    const userEmails: string[] = [];
    const usernames: string[] = [];
    const userPasswords: string[] = [];
    const userRoles: string[] = [];
    const userCreatedAts: string[] = [];

    // Static bcrypt hash for 'password123'
    const passwordHash = '$2b$10$wN1QGg10uM6t2z6x8uCj0OSgK8SgV9lI3W2tX4oO8eF3q1m8kZkKu';
    const now = Date.now();
    const ms180Days = 180 * 24 * 60 * 60 * 1000;

    for (let i = 1; i <= TARGET_USERS; i++) {
      const uId = uuid();
      userIds.push(uId);
      const name = `user_${i.toString().padStart(5, '0')}`;
      usernames.push(name);
      userEmails.push(`${name}@practice.portal`);
      userPasswords.push(passwordHash);
      userRoles.push(i <= 10 ? 'admin' : 'user');

      // Creation date spread across past 180 days
      const createdAt = new Date(now - Math.floor(random() * ms180Days)).toISOString();
      userCreatedAts.push(createdAt);
    }

    // Bulk insert users using UNNEST in batches
    console.log(`[Seed-Load] Inserting users in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < TARGET_USERS; i += BATCH_SIZE) {
      const chunkIds = userIds.slice(i, i + BATCH_SIZE);
      const chunkNames = usernames.slice(i, i + BATCH_SIZE);
      const chunkEmails = userEmails.slice(i, i + BATCH_SIZE);
      const chunkPass = userPasswords.slice(i, i + BATCH_SIZE);
      const chunkRoles = userRoles.slice(i, i + BATCH_SIZE);
      const chunkCreated = userCreatedAts.slice(i, i + BATCH_SIZE);

      await client.query(
        `INSERT INTO users (id, username, email, password_hash, role, created_at, updated_at)
         SELECT u.id, u.name, u.email, u.pass, u.role::user_role, u.created::timestamptz, u.created::timestamptz
         FROM UNNEST(
           $1::uuid[],
           $2::text[],
           $3::text[],
           $4::text[],
           $5::text[],
           $6::text[]
         ) AS u(id, name, email, pass, role, created)
         ON CONFLICT (username) DO NOTHING`,
        [chunkIds, chunkNames, chunkEmails, chunkPass, chunkRoles, chunkCreated]
      );
    }
    console.log(`[Seed-Load] Successfully inserted users.`);

    // 3. Generate and bulk insert 100,000 Submissions
    console.log(`[Seed-Load] Generating ${TARGET_SUBMISSIONS} realistic submissions...`);

    const subIds: string[] = [];
    const subUserIds: string[] = [];
    const subProblemIds: string[] = [];
    const subCodes: string[] = [];
    const subStatuses: string[] = [];
    const subPassed: number[] = [];
    const subTotal: number[] = [];
    const subResults: string[] = [];
    const subCreatedAts: string[] = [];
    const subJudgedAts: string[] = [];

    // Track for user_problem_stats generation
    // Key: `${userId}_${problemId}` -> { attempts, solved, firstSolvedAt, lastAttemptedAt }
    const statsMap = new Map<
      string,
      {
        userId: string;
        problemId: string;
        attempts: number;
        solved: number;
        firstSolvedAt: string | null;
        lastAttemptedAt: string;
      }
    >();

    const boilerplateCode = `function solve(input) {\n  // Automated submission draft\n  return input;\n}`;

    for (let i = 0; i < TARGET_SUBMISSIONS; i++) {
      const sId = uuid();
      const userIndex = getParetoUserIndex(TARGET_USERS);
      const uId = userIds[userIndex];
      const pId = randomChoice(weightedProblems);
      const prob = problemMap.get(pId)!;

      // Status distribution
      const statusRoll = random();
      let status: 'judged' | 'failed' | 'queued' | 'running';
      if (statusRoll < 0.92) status = 'judged';
      else if (statusRoll < 0.97) status = 'failed';
      else if (statusRoll < 0.985) status = 'running';
      else status = 'queued';

      // Test pass logic based on difficulty
      const totalTests = 5;
      let passedTests = 0;

      if (status === 'judged') {
        const passProb =
          prob.difficulty === 'Easy' ? 0.72 : prob.difficulty === 'Medium' ? 0.45 : 0.22;
        if (random() < passProb) {
          passedTests = totalTests;
        } else {
          passedTests = randomInt(1, totalTests - 1);
        }
      } else if (status === 'failed') {
        passedTests = randomInt(0, 2);
      }

      const resultsPayload = JSON.stringify({
        summary: `${passedTests}/${totalTests} tests passed`,
        runtimeMs: randomInt(12, 140),
        memoryKb: randomInt(1024, 8192),
      });

      const createdAtDate = new Date(now - Math.floor(random() * ms180Days));
      const createdAt = createdAtDate.toISOString();
      const judgedAt =
        status === 'judged' || status === 'failed'
          ? new Date(createdAtDate.getTime() + randomInt(200, 3000)).toISOString()
          : null;

      subIds.push(sId);
      subUserIds.push(uId);
      subProblemIds.push(pId);
      subCodes.push(boilerplateCode);
      subStatuses.push(status);
      subPassed.push(passedTests);
      subTotal.push(totalTests);
      subResults.push(resultsPayload);
      subCreatedAts.push(createdAt);
      subJudgedAts.push(judgedAt || createdAt);

      // Aggregate into stats map
      const statsKey = `${uId}_${pId}`;
      const isSolved = passedTests === totalTests && totalTests > 0;
      const existingStat = statsMap.get(statsKey);

      if (!existingStat) {
        statsMap.set(statsKey, {
          userId: uId,
          problemId: pId,
          attempts: 1,
          solved: isSolved ? 1 : 0,
          firstSolvedAt: isSolved ? createdAt : null,
          lastAttemptedAt: createdAt,
        });
      } else {
        existingStat.attempts += 1;
        if (isSolved && existingStat.solved === 0) {
          existingStat.solved = 1;
          existingStat.firstSolvedAt = createdAt;
        }
        if (createdAt > existingStat.lastAttemptedAt) {
          existingStat.lastAttemptedAt = createdAt;
        }
      }
    }

    console.log(`[Seed-Load] Inserting submissions in batches of ${BATCH_SIZE}...`);
    for (let i = 0; i < TARGET_SUBMISSIONS; i += BATCH_SIZE) {
      const cIds = subIds.slice(i, i + BATCH_SIZE);
      const cUsers = subUserIds.slice(i, i + BATCH_SIZE);
      const cProbs = subProblemIds.slice(i, i + BATCH_SIZE);
      const cCodes = subCodes.slice(i, i + BATCH_SIZE);
      const cStatus = subStatuses.slice(i, i + BATCH_SIZE);
      const cPassed = subPassed.slice(i, i + BATCH_SIZE);
      const cTotal = subTotal.slice(i, i + BATCH_SIZE);
      const cResults = subResults.slice(i, i + BATCH_SIZE);
      const cCreated = subCreatedAts.slice(i, i + BATCH_SIZE);
      const cJudged = subJudgedAts.slice(i, i + BATCH_SIZE);

      await client.query(
        `INSERT INTO submissions (
           id, user_id, problem_id, code, status, passed, total, results, created_at, judged_at
         )
         SELECT
           s.id, s.user_id, s.problem_id, s.code, s.status::submission_status,
           s.passed, s.total, s.results::jsonb, s.created::timestamptz, s.judged::timestamptz
         FROM UNNEST(
           $1::uuid[],
           $2::uuid[],
           $3::uuid[],
           $4::text[],
           $5::text[],
           $6::int[],
           $7::int[],
           $8::text[],
           $9::text[],
           $10::text[]
         ) AS s(id, user_id, problem_id, code, status, passed, total, results, created, judged)
         ON CONFLICT (id) DO NOTHING`,
        [cIds, cUsers, cProbs, cCodes, cStatus, cPassed, cTotal, cResults, cCreated, cJudged]
      );
      if ((i + BATCH_SIZE) % 20000 === 0 || i + BATCH_SIZE >= TARGET_SUBMISSIONS) {
        console.log(
          `[Seed-Load] Inserted ${Math.min(i + BATCH_SIZE, TARGET_SUBMISSIONS)} submissions...`
        );
      }
    }

    // 4. Bulk insert aggregated user_problem_stats
    const statsArray = Array.from(statsMap.values());
    console.log(`[Seed-Load] Inserting ${statsArray.length} user_problem_stats records...`);

    const upsIds: string[] = [];
    const upsUsers: string[] = [];
    const upsProbs: string[] = [];
    const upsAttempts: number[] = [];
    const upsSolved: boolean[] = [];
    const upsFirstSolved: Array<string | null> = [];
    const upsLastAttempt: string[] = [];

    for (const stat of statsArray) {
      upsIds.push(uuid());
      upsUsers.push(stat.userId);
      upsProbs.push(stat.problemId);
      upsAttempts.push(stat.attempts);
      upsSolved.push(Boolean(stat.solved));
      upsFirstSolved.push(stat.firstSolvedAt);
      upsLastAttempt.push(stat.lastAttemptedAt);
    }

    for (let i = 0; i < statsArray.length; i += BATCH_SIZE) {
      const cIds = upsIds.slice(i, i + BATCH_SIZE);
      const cUsers = upsUsers.slice(i, i + BATCH_SIZE);
      const cProbs = upsProbs.slice(i, i + BATCH_SIZE);
      const cAttempts = upsAttempts.slice(i, i + BATCH_SIZE);
      const cSolved = upsSolved.slice(i, i + BATCH_SIZE);
      const cFirst = upsFirstSolved.slice(i, i + BATCH_SIZE);
      const cLast = upsLastAttempt.slice(i, i + BATCH_SIZE);

      await client.query(
        `INSERT INTO user_problem_stats (
           id, user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at
         )
         SELECT
           st.id, st.user_id, st.problem_id, st.attempts, st.solved::boolean,
           st.first_solved::timestamptz, st.last_attempt::timestamptz
         FROM UNNEST(
           $1::uuid[],
           $2::uuid[],
           $3::uuid[],
           $4::int[],
           $5::boolean[],
           $6::text[],
           $7::text[]
         ) AS st(id, user_id, problem_id, attempts, solved, first_solved, last_attempt)
         ON CONFLICT (user_id, problem_id) DO UPDATE SET
           attempts = EXCLUDED.attempts,
           solved = EXCLUDED.solved,
           first_solved_at = EXCLUDED.first_solved_at,
           last_attempted_at = EXCLUDED.last_attempted_at`,
        [cIds, cUsers, cProbs, cAttempts, cSolved, cFirst, cLast]
      );
    }
    console.log(`[Seed-Load] Successfully inserted user_problem_stats.`);

    // 5. Generate realistic sync_op_log entries (~15,000 operations)
    console.log(`[Seed-Load] Generating 15,000 sync_op_log entries for sync benchmarking...`);
    const opIds: string[] = [];
    const opDevices: string[] = [];
    const opUsers: string[] = [];
    const opEntities: string[] = [];
    const opTypes: string[] = [];
    const opPayloads: string[] = [];
    const opClientTimes: string[] = [];
    const opHlcs: string[] = [];
    const opVersions: number[] = [];

    for (let i = 0; i < 15000; i++) {
      const opId = uuid();
      const uId = userIds[randomInt(0, Math.min(1000, TARGET_USERS - 1))];
      const devId = `dev_${uId.slice(0, 8)}`;
      const pId = randomChoice(weightedProblems);
      const timeMs = now - Math.floor(random() * (7 * 24 * 60 * 60 * 1000));
      const clientTime = new Date(timeMs).toISOString();
      const hlc = `${timeMs.toString().padStart(13, '0')}.00001.${devId}`;

      opIds.push(opId);
      opDevices.push(devId);
      opUsers.push(uId);
      opEntities.push(i % 5 === 0 ? 'settings' : 'submission');
      opTypes.push(i % 5 === 0 ? 'UPDATE' : 'INSERT');
      opPayloads.push(
        i % 5 === 0
          ? JSON.stringify({ settings: { theme: 'nord', fontSize: 14 } })
          : JSON.stringify({ problemId: pId, code: boilerplateCode, status: 'judged' })
      );
      opClientTimes.push(clientTime);
      opHlcs.push(hlc);
      opVersions.push(1);
    }

    for (let i = 0; i < opIds.length; i += BATCH_SIZE) {
      await client.query(
        `INSERT INTO sync_op_log (
           op_id, device_id, user_id, entity, operation_type,
           payload, client_timestamp, hybrid_logical_clock, schema_version
         )
         SELECT
           o.op_id, o.device_id, o.user_id, o.entity, o.op_type,
           o.payload::jsonb, o.client_time::timestamptz, o.hlc, o.version
         FROM UNNEST(
           $1::uuid[],
           $2::text[],
           $3::uuid[],
           $4::text[],
           $5::text[],
           $6::text[],
           $7::text[],
           $8::text[],
           $9::int[]
         ) AS o(op_id, device_id, user_id, entity, op_type, payload, client_time, hlc, version)
         ON CONFLICT (op_id) DO NOTHING`,
        [
          opIds.slice(i, i + BATCH_SIZE),
          opDevices.slice(i, i + BATCH_SIZE),
          opUsers.slice(i, i + BATCH_SIZE),
          opEntities.slice(i, i + BATCH_SIZE),
          opTypes.slice(i, i + BATCH_SIZE),
          opPayloads.slice(i, i + BATCH_SIZE),
          opClientTimes.slice(i, i + BATCH_SIZE),
          opHlcs.slice(i, i + BATCH_SIZE),
          opVersions.slice(i, i + BATCH_SIZE),
        ]
      );
    }
    console.log(`[Seed-Load] Successfully inserted sync_op_log entries.`);

    // Update PostgreSQL table planner statistics
    console.log(`[Seed-Load] Running ANALYZE on all tables...`);
    await client.query('ANALYZE users, submissions, user_problem_stats, sync_op_log, problems;');

    const durationMs = Date.now() - startTime;
    console.log(`[Seed-Load] Done in ${(durationMs / 1000).toFixed(2)}s!`);

    return {
      usersCount: TARGET_USERS,
      submissionsCount: TARGET_SUBMISSIONS,
      statsCount: statsArray.length,
      syncOpsCount: opIds.length,
      durationMs,
    };
  } finally {
    client.release();
  }
}

// CLI entry point
if (require.main === module) {
  runLoadSeeder()
    .then((summary) => {
      console.log('Seed summary:', summary);
      closePool().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Seed-load failed:', err);
      closePool().then(() => process.exit(1));
    });
}
