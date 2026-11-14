import { getPoolMetrics } from '../db/pool';

export interface QueryMetric {
  count: number;
  totalDurationSeconds: number;
  maxDurationSeconds: number;
}

export class MetricsService {
  private static instance: MetricsService;
  private syncOps: Record<string, number> = {
    applied: 0,
    rejected: 0,
    conflict: 0,
  };
  private queryMetrics: Map<string, QueryMetric> = new Map();

  private constructor() {}

  public static getInstance(): MetricsService {
    if (!MetricsService.instance) {
      MetricsService.instance = new MetricsService();
    }
    return MetricsService.instance;
  }

  recordSyncOp(status: 'applied' | 'rejected' | 'conflict', count: number = 1): void {
    this.syncOps[status] = (this.syncOps[status] || 0) + count;
  }

  recordQueryDuration(queryName: string, durationSeconds: number): void {
    const current = this.queryMetrics.get(queryName) || {
      count: 0,
      totalDurationSeconds: 0,
      maxDurationSeconds: 0,
    };

    current.count += 1;
    current.totalDurationSeconds += durationSeconds;
    current.maxDurationSeconds = Math.max(current.maxDurationSeconds, durationSeconds);
    this.queryMetrics.set(queryName, current);
  }

  renderPrometheusMetrics(): string {
    const pool = getPoolMetrics();
    const mem = process.memoryUsage();
    const lines: string[] = [];

    // System uptime
    lines.push('# HELP dsa_uptime_seconds Total application uptime in seconds.');
    lines.push('# TYPE dsa_uptime_seconds gauge');
    lines.push(`dsa_uptime_seconds ${Math.floor(process.uptime())}`);

    // Process Memory
    lines.push('# HELP dsa_memory_heap_used_bytes Process heap memory used in bytes.');
    lines.push('# TYPE dsa_memory_heap_used_bytes gauge');
    lines.push(`dsa_memory_heap_used_bytes ${mem.heapUsed}`);

    // DB Pool Metrics
    lines.push('# HELP dsa_db_pool_total_connections Total active database connections in the pool.');
    lines.push('# TYPE dsa_db_pool_total_connections gauge');
    lines.push(`dsa_db_pool_total_connections ${pool.totalCount}`);

    lines.push('# HELP dsa_db_pool_idle_connections Number of idle connections in the pool.');
    lines.push('# TYPE dsa_db_pool_idle_connections gauge');
    lines.push(`dsa_db_pool_idle_connections ${pool.idleCount}`);

    lines.push('# HELP dsa_db_pool_waiting_clients Number of queries queued waiting for a free connection.');
    lines.push('# TYPE dsa_db_pool_waiting_clients gauge');
    lines.push(`dsa_db_pool_waiting_clients ${pool.waitingCount}`);

    // Sync Operations Metrics
    lines.push('# HELP dsa_sync_ops_total Total sync operations processed by the sync engine.');
    lines.push('# TYPE dsa_sync_ops_total counter');
    for (const [status, count] of Object.entries(this.syncOps)) {
      lines.push(`dsa_sync_ops_total{status="${status}"} ${count}`);
    }

    // Query Performance Metrics
    lines.push('# HELP dsa_query_execution_count_total Total execution count of core database queries.');
    lines.push('# TYPE dsa_query_execution_count_total counter');
    for (const [query, metric] of this.queryMetrics.entries()) {
      lines.push(`dsa_query_execution_count_total{query="${query}"} ${metric.count}`);
    }

    lines.push('# HELP dsa_query_max_duration_seconds Peak execution duration observed for core queries.');
    lines.push('# TYPE dsa_query_max_duration_seconds gauge');
    for (const [query, metric] of this.queryMetrics.entries()) {
      lines.push(`dsa_query_max_duration_seconds{query="${query}"} ${metric.maxDurationSeconds.toFixed(6)}`);
    }

    return lines.join('\n') + '\n';
  }
}
