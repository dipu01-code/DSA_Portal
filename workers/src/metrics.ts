import * as http from 'http';
import type { Pool } from 'pg';

// Job duration buckets in seconds: a normal solution takes <1 s, a 5-test timeout ~10 s.
const BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30];

export type JobOutcome = 'judged' | 'retried' | 'dead' | 'lease_lost';

/** In-process counters + histogram for this worker; queue depths are read from PostgreSQL on scrape. */
export class QueueMetrics {
  readonly jobs: Record<JobOutcome, number> = { judged: 0, retried: 0, dead: 0, lease_lost: 0 };
  private bucketCounts = BUCKETS.map(() => 0);
  private sum = 0;
  private count = 0;

  observe(seconds: number) {
    BUCKETS.forEach((le, i) => {
      if (seconds <= le) this.bucketCounts[i]++;
    });
    this.sum += seconds;
    this.count++;
  }

  /** Prometheus text exposition format 0.0.4. */
  async render(pool: Pool): Promise<string> {
    const { rows } = await pool.query<{ status: string; n: number }>(
      `SELECT status::text, count(*)::int AS n FROM submissions
       WHERE status IN ('queued', 'running', 'failed') GROUP BY status`
    );
    const depth = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    const lines = [
      '# HELP dsa_queue_waiting Submissions waiting for a worker (includes retries in backoff).',
      '# TYPE dsa_queue_waiting gauge',
      `dsa_queue_waiting ${depth('queued')}`,
      '# HELP dsa_queue_active Submissions claimed by a worker right now.',
      '# TYPE dsa_queue_active gauge',
      `dsa_queue_active ${depth('running')}`,
      '# HELP dsa_queue_failed Submissions in the dead-letter list (status failed).',
      '# TYPE dsa_queue_failed gauge',
      `dsa_queue_failed ${depth('failed')}`,
      '# HELP dsa_queue_jobs_total Jobs finished by this worker process, by outcome.',
      '# TYPE dsa_queue_jobs_total counter',
      ...Object.entries(this.jobs).map(
        ([outcome, n]) => `dsa_queue_jobs_total{outcome="${outcome}"} ${n}`
      ),
      '# HELP dsa_queue_job_duration_seconds Time from claim to saved result.',
      '# TYPE dsa_queue_job_duration_seconds histogram',
      ...BUCKETS.map(
        (le, i) => `dsa_queue_job_duration_seconds_bucket{le="${le}"} ${this.bucketCounts[i]}`
      ),
      `dsa_queue_job_duration_seconds_bucket{le="+Inf"} ${this.count}`,
      `dsa_queue_job_duration_seconds_sum ${this.sum}`,
      `dsa_queue_job_duration_seconds_count ${this.count}`,
    ];
    return lines.join('\n') + '\n';
  }
}

/** GET /metrics for Prometheus. Anything else is 404. */
export function serveMetrics(port: number, metrics: QueueMetrics, pool: Pool): http.Server {
  return http
    .createServer(async (req, res) => {
      if (req.method !== 'GET' || req.url !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = await metrics.render(pool);
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(body);
      } catch {
        res.writeHead(503).end('database unavailable\n');
      }
    })
    .listen(port);
}
