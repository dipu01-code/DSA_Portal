import { Pool } from 'pg';
import { getPool, getPoolMetrics, PoolMetrics } from '../db/pool';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
  checks: {
    postgres: {
      status: 'ok' | 'down';
      latencyMs: number;
      error?: string;
    };
    pool: PoolMetrics;
  };
}

export class HealthService {
  private pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool || getPool();
  }

  async checkLiveness(): Promise<{ status: 'ok'; uptimeSeconds: number }> {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async checkReadiness(): Promise<HealthCheckResult> {
    let pgStatus: 'ok' | 'down' = 'ok';
    let pgError: string | undefined;
    let pgLatencyMs = 0;

    try {
      const pingStart = Date.now();
      await this.pool.query('SELECT 1');
      pgLatencyMs = Date.now() - pingStart;
    } catch (err: any) {
      pgStatus = 'down';
      pgError = err.message;
    }

    const mem = process.memoryUsage();
    const poolMetrics = getPoolMetrics();

    let overallStatus: 'ok' | 'degraded' | 'down' = 'ok';
    if (pgStatus === 'down') {
      overallStatus = 'down';
    } else if (poolMetrics.waitingCount > 5 || pgLatencyMs > 500) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      },
      checks: {
        postgres: {
          status: pgStatus,
          latencyMs: pgLatencyMs,
          ...(pgError ? { error: pgError } : {}),
        },
        pool: poolMetrics,
      },
    };
  }
}
