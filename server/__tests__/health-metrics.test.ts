import { HealthService } from '../src/health/health.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { Pool } from 'pg';

describe('Health & Metrics Infrastructure', () => {
  let mockPool: Partial<Pool>;

  beforeEach(() => {
    mockPool = {
      query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) as any,
    };
  });

  describe('HealthService', () => {
    it('returns healthy liveness response', async () => {
      const healthService = new HealthService(mockPool as Pool);
      const live = await healthService.checkLiveness();

      expect(live.status).toBe('ok');
      expect(typeof live.uptimeSeconds).toBe('number');
      expect(live.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('returns healthy readiness check when pool is accessible', async () => {
      const healthService = new HealthService(mockPool as Pool);
      const ready = await healthService.checkReadiness();

      expect(ready.status).toBe('ok');
      expect(ready.checks.postgres.status).toBe('ok');
      expect(typeof ready.checks.postgres.latencyMs).toBe('number');
      expect(ready.checks.pool).toBeDefined();
      expect(ready.memory.heapUsedMb).toBeGreaterThan(0);
    });

    it('returns down readiness check when database fails', async () => {
      mockPool.query = jest.fn().mockRejectedValue(new Error('Connection refused'));
      const healthService = new HealthService(mockPool as Pool);
      const ready = await healthService.checkReadiness();

      expect(ready.status).toBe('down');
      expect(ready.checks.postgres.status).toBe('down');
      expect(ready.checks.postgres.error).toContain('Connection refused');
    });
  });

  describe('MetricsService', () => {
    it('records sync operations and query latencies', () => {
      const metricsService = MetricsService.getInstance();
      metricsService.recordSyncOp('applied', 5);
      metricsService.recordSyncOp('conflict', 2);
      metricsService.recordQueryDuration('leaderboard_query', 0.015);

      const exposition = metricsService.renderPrometheusMetrics();

      expect(exposition).toContain('# HELP dsa_uptime_seconds');
      expect(exposition).toContain('# TYPE dsa_uptime_seconds gauge');
      expect(exposition).toContain('dsa_db_pool_total_connections');
      expect(exposition).toContain('dsa_sync_ops_total{status="applied"} 5');
      expect(exposition).toContain('dsa_sync_ops_total{status="conflict"} 2');
      expect(exposition).toContain('dsa_query_execution_count_total{query="leaderboard_query"} 1');
      expect(exposition).toContain(
        'dsa_query_max_duration_seconds{query="leaderboard_query"} 0.015000'
      );
    });
  });
});
