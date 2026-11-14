# Handover — Day 9, Person 2

## What was built

Day 9 delivers complete production health probing, Prometheus metrics instrumentation, alerting rules, and incident runbooks:

1. **Health Service & Dual-Tier Probes**:
   - `server/src/health/health.service.ts` & `server/src/health/health.controller.ts`
   - `GET /health/live`: Fast process liveness check (200 OK) for container orchestrators.
   - `GET /health/ready`: Deep readiness probe executing database ping and reporting pool metrics (`totalCount`, `idleCount`, `waitingCount`, and roundtrip query latency).
2. **Prometheus Metrics Engine**:
   - `server/src/metrics/metrics.service.ts` & `server/src/metrics/metrics.controller.ts`
   - `GET /metrics`: Standard text/plain Prometheus exposition containing:
     - Pool gauges: `dsa_db_pool_total_connections`, `dsa_db_pool_idle_connections`, `dsa_db_pool_waiting_clients`
     - Sync counters: `dsa_sync_ops_total{status="applied|rejected|conflict"}`
     - Query metrics: `dsa_query_execution_count_total`, `dsa_query_max_duration_seconds`
     - System gauges: `dsa_uptime_seconds`, `dsa_memory_heap_used_bytes`
3. **Alerting Infrastructure & Prometheus Configuration**:
   - `infra/monitoring/prometheus.yml`: Scrapes API server every 15s.
   - `infra/monitoring/alerts.yml`: Production alert rules for connection pool saturation, database down, elevated query latency, and high sync conflicts.
4. **Operations & Incident Response Runbook**:
   - `docs/infra/runbook.md`: Diagnostic workflows for connection pool exhaustion, database crashes, and materialized view cache refreshes.
5. **Automated Tests**:
   - `server/__tests__/health-metrics.test.ts`: 4 comprehensive unit tests verifying liveness, readiness failover, and metrics formatting.

---

## Endpoints for Persons 1 & 3

- `GET /health/live` — Returns `{ status: 'ok', uptimeSeconds: 124 }`
- `GET /health/ready` — Returns 200 `{ status: 'ok', checks: { postgres: { status: 'ok', latencyMs: 2 }, pool: { totalCount: 4, idleCount: 4, waitingCount: 0 } } }` (or 503 if PostgreSQL is down)
- `GET /metrics` — Prometheus metrics endpoint.

---

## Viva Defense (Design Decisions & Trade-offs)

> **Viva Defense — Day 9 Architectural Rationale:**
>
> 1. **Liveness vs. Readiness Probe Separation**: Conflating liveness with readiness causes catastrophic cascading restarts during transient database blips. A failed readiness probe stops routing incoming HTTP traffic to the pod while keeping the Node.js process alive; a failed liveness probe forcibly kills the process.
> 2. **Tracking `waitingCount` Over `totalCount`**: In a pooled architecture, having 20 active connections is normal under heavy traffic. The true indicator of pool saturation and user-facing queuing is `waitingCount > 0`, which directly quantifies request starvation.
> 3. **Pull-Based Prometheus Metrics Model**: Pull-based scraping prevents application servers from being overwhelmed by metric pushing loops and decouples the monitoring infrastructure from the application lifecycle.
> 4. **Micro-Benchmarked Health Ping**: The readiness check runs `SELECT 1` with a strict latency measurement, catching subtle database degradation (e.g. disk IOPS throttling) before it triggers widespread request timeouts.
