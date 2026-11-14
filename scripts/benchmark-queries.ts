import { pool, closePool } from '../server/src/db/pool';

export interface QueryBenchmarkResult {
  queryId: string;
  queryName: string;
  executionTimeMs: number;
  planningTimeMs: number;
  totalTimeMs: number;
  sharedHitBlocks: number;
  sharedReadBlocks: number;
  scanType: string;
  planSummary: string;
}

export async function runQueryBenchmarks(label = 'Benchmark'): Promise<QueryBenchmarkResult[]> {
  const client = await pool.connect();
  const results: QueryBenchmarkResult[] = [];

  try {
    // 1. Pick an active power user and a problem for parameterized testing
    const userRes = await client.query<{ id: string }>(
      `SELECT user_id AS id FROM submissions GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1`
    );
    const sampleUserId = userRes.rows[0]?.id || '00000000-0000-0000-0000-000000000001';

    const probRes = await client.query<{ id: string }>(
      `SELECT id FROM problems WHERE slug = 'two-sum' LIMIT 1`
    );
    const sampleProblemId = probRes.rows[0]?.id || '00000000-0000-0000-0000-000000000001';

    const queries: Array<{ id: string; name: string; sql: string; params: any[] }> = [
      {
        id: 'Q1',
        name: 'Random Problem by Topic + Difficulty',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, slug, title, description, starter_code
              FROM problems
              WHERE topic = 'Dynamic Programming' AND difficulty = 'Medium' AND is_published = true
              ORDER BY random()
              LIMIT 1;`,
        params: [],
      },
      {
        id: 'Q2',
        name: 'Problem Catalog List Filtered & Ordered',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, slug, title, topic, difficulty, created_at
              FROM problems
              WHERE topic = 'Arrays' AND is_published = true
              ORDER BY created_at ASC
              LIMIT 20;`,
        params: [],
      },
      {
        id: 'Q3',
        name: 'User Submission History with Pagination',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, problem_id, status, passed, total, created_at
              FROM submissions
              WHERE user_id = $1::uuid
              ORDER BY created_at DESC
              LIMIT 20;`,
        params: [sampleUserId],
      },
      {
        id: 'Q4',
        name: 'Global Leaderboard (Aggregated Solved & Submissions)',
        sql: label.includes('AFTER')
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT user_id AS id, username, solved_count, total_submissions, score, last_submission_at, rank
             FROM mv_leaderboard
             ORDER BY rank ASC
             LIMIT 50;`
          : `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT u.id, u.username,
                    COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed = s.total AND s.total > 0) AS solved_count,
                    COUNT(s.id) AS total_submissions,
                    MAX(s.created_at) AS last_submission_at
             FROM users u
             JOIN submissions s ON s.user_id = u.id
             GROUP BY u.id, u.username
             HAVING COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed = s.total AND s.total > 0) > 0
             ORDER BY solved_count DESC, last_submission_at ASC
             LIMIT 50;`,
        params: [],
      },
      {
        id: 'Q5',
        name: 'User Topic Breakdown Stats',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT p.topic,
                     SUM(ups.attempts) AS total_attempts,
                     COUNT(ups.problem_id) FILTER (WHERE ups.solved = true) AS solved_count
              FROM user_problem_stats ups
              JOIN problems p ON p.id = ups.problem_id
              WHERE ups.user_id = $1::uuid
              GROUP BY p.topic
              ORDER BY p.topic ASC;`,
        params: [sampleUserId],
      },
      {
        id: 'Q6',
        name: 'User Profile Overall Stats Aggregation',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT
                COUNT(*) AS attempted_problems,
                COUNT(*) FILTER (WHERE solved = true) AS solved_problems,
                SUM(attempts) AS total_attempts,
                MIN(first_solved_at) AS first_solved_at,
                MAX(last_attempted_at) AS last_active_at
              FROM user_problem_stats
              WHERE user_id = $1::uuid;`,
        params: [sampleUserId],
      },
      {
        id: 'Q7',
        name: 'Daily Challenge Lookup',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT dc.challenge_date, p.id, p.slug, p.title, p.topic, p.difficulty
              FROM daily_challenges dc
              JOIN problems p ON p.id = dc.problem_id
              WHERE dc.challenge_date = CURRENT_DATE;`,
        params: [],
      },
      {
        id: 'Q8',
        name: 'Sync Pull Keyset Cursor Query',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT server_seq, op_id, device_id, user_id, entity, operation_type,
                     payload, client_timestamp, hybrid_logical_clock
              FROM sync_op_log
              WHERE server_seq > 5000 AND (user_id = $1::uuid OR entity = 'problem')
              ORDER BY server_seq ASC
              LIMIT 100;`,
        params: [sampleUserId],
      },
      {
        id: 'Q9',
        name: 'Site-wide Recent Activity Feed (Judged Submissions)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT s.id, u.username, p.title, p.topic, p.difficulty, s.passed, s.total, s.created_at
              FROM submissions s
              JOIN users u ON u.id = s.user_id
              JOIN problems p ON p.id = s.problem_id
              WHERE s.status = 'judged'
              ORDER BY s.created_at DESC
              LIMIT 50;`,
        params: [],
      },
      {
        id: 'Q10',
        name: 'User Problem Solved Verification Check',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, passed, total, status, created_at
              FROM submissions
              WHERE user_id = $1::uuid AND problem_id = $2::uuid AND passed = total AND total > 0
              ORDER BY created_at ASC
              LIMIT 1;`,
        params: [sampleUserId, sampleProblemId],
      },
    ];

    console.log(`\n=============================================================`);
    console.log(`[${label}] Executing EXPLAIN (ANALYZE, BUFFERS) for 10 Queries`);
    console.log(`=============================================================\n`);

    for (const q of queries) {
      // Warm up cache run
      await client.query(q.sql, q.params);
      // Measured run
      const res = await client.query(q.sql, q.params);
      const planRoot = res.rows[0]['QUERY PLAN'][0];
      const plan = planRoot.Plan;

      const execTime = planRoot['Execution Time'];
      const planTime = planRoot['Planning Time'];
      const totalTime = Number((execTime + planTime).toFixed(3));
      const sharedHit = plan['Shared Hit Blocks'] || 0;
      const sharedRead = plan['Shared Read Blocks'] || 0;
      const scanType = extractScanType(plan);
      const planSummary = `${plan['Node Type']} on ${plan['Relation Name'] || plan['Index Name'] || 'subplan'}`;

      console.log(
        `[${q.id}] ${q.name.padEnd(46)} | Total: ${totalTime.toFixed(2)}ms (Exec: ${execTime.toFixed(2)}ms) | Buffers: ${sharedHit + sharedRead} (${scanType})`
      );

      results.push({
        queryId: q.id,
        queryName: q.name,
        executionTimeMs: execTime,
        planningTimeMs: planTime,
        totalTimeMs: totalTime,
        sharedHitBlocks: sharedHit,
        sharedReadBlocks: sharedRead,
        scanType,
        planSummary,
      });
    }

    return results;
  } finally {
    client.release();
  }
}

function extractScanType(plan: any): string {
  if (plan['Node Type']?.includes('Scan')) {
    return plan['Node Type'];
  }
  if (plan.Plans && Array.isArray(plan.Plans)) {
    for (const sub of plan.Plans) {
      const found = extractScanType(sub);
      if (found !== 'Unknown') return found;
    }
  }
  return plan['Node Type'] || 'Unknown';
}

export async function runPaginationBenchmark(): Promise<{
  offsetShallow: number;
  offsetDeep: number;
  keysetShallow: number;
  keysetDeep: number;
}> {
  const client = await pool.connect();
  try {
    console.log(`\n=============================================================`);
    console.log(`Benchmarking Keyset vs. Offset Pagination (100k submissions)`);
    console.log(`=============================================================\n`);

    // 1. Offset Page 1 (Shallow: OFFSET 0 LIMIT 20)
    const offShallowRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, user_id, problem_id, created_at
       FROM submissions
       ORDER BY created_at DESC, id DESC
       OFFSET 0 LIMIT 20;`
    );
    const offShallow = offShallowRes.rows[0]['QUERY PLAN'][0]['Execution Time'];

    // 2. Offset Page 2500 (Deep: OFFSET 50000 LIMIT 20)
    const offDeepRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, user_id, problem_id, created_at
       FROM submissions
       ORDER BY created_at DESC, id DESC
       OFFSET 50000 LIMIT 20;`
    );
    const offDeep = offDeepRes.rows[0]['QUERY PLAN'][0]['Execution Time'];

    // 3. Keyset Page 1 (Shallow)
    const keyShallowRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, user_id, problem_id, created_at
       FROM submissions
       ORDER BY created_at DESC, id DESC
       LIMIT 20;`
    );
    const keyShallow = keyShallowRes.rows[0]['QUERY PLAN'][0]['Execution Time'];

    // Fetch pivot row for deep keyset
    const pivotRes = await client.query<{ created_at: Date; id: string }>(
      `SELECT created_at, id FROM submissions ORDER BY created_at DESC, id DESC OFFSET 50000 LIMIT 1;`
    );
    const pivot = pivotRes.rows[0];

    // 4. Keyset Page 2500 (Deep: WHERE (created_at, id) < (pivot))
    const keyDeepRes = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, user_id, problem_id, created_at
       FROM submissions
       WHERE (created_at, id) < ($1::timestamptz, $2::uuid)
       ORDER BY created_at DESC, id DESC
       LIMIT 20;`,
      [pivot.created_at, pivot.id]
    );
    const keyDeep = keyDeepRes.rows[0]['QUERY PLAN'][0]['Execution Time'];

    console.log(`Offset Pagination (Page 1 - Shallow):   ${offShallow.toFixed(2)} ms`);
    console.log(`Offset Pagination (Page 2500 - Deep):  ${offDeep.toFixed(2)} ms`);
    console.log(`Keyset Pagination (Page 1 - Shallow):   ${keyShallow.toFixed(2)} ms`);
    console.log(`Keyset Pagination (Page 2500 - Deep):  ${keyDeep.toFixed(2)} ms`);

    const speedupDeep = (offDeep / keyDeep).toFixed(1);
    console.log(`Keyset deep pagination speedup: ${speedupDeep}x faster!`);

    return {
      offsetShallow: offShallow,
      offsetDeep: offDeep,
      keysetShallow: keyShallow,
      keysetDeep: keyDeep,
    };
  } finally {
    client.release();
  }
}

// CLI entry point
if (require.main === module) {
  (async () => {
    const fs = await import('fs');
    const path = await import('path');

    const mode = process.argv[2] || 'before';
    const qResults = await runQueryBenchmarks(`${mode.toUpperCase()} Benchmark`);
    const pResults = await runPaginationBenchmark();

    const outputFilePath = path.join(__dirname, 'benchmark-results.json');
    let existingData: Record<string, any> = {};
    if (fs.existsSync(outputFilePath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(outputFilePath, 'utf8'));
      } catch {}
    }

    existingData[mode] = {
      timestamp: new Date().toISOString(),
      queries: qResults,
      pagination: pResults,
    };

    fs.writeFileSync(outputFilePath, JSON.stringify(existingData, null, 2), 'utf8');
    console.log(`\nResults saved to ${outputFilePath}`);
    console.log('\nBenchmark completed successfully.');
    await closePool();
  })().catch((err) => {
    console.error('Benchmark failed:', err);
    closePool().then(() => process.exit(1));
  });
}
