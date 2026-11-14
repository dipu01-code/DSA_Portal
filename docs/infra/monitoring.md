# Monitoring & Observability Architecture — DSA Practice Platform

## Overview
The monitoring subsystem provides real-time health verification and performance metrics across the database, sync engine, and backend services.

---

## 1. Metric Exposition (`GET /metrics`)
Exposed via Prometheus standard exposition format at `/metrics`:

```
# HELP dsa_db_pool_total_connections Total active database connections in the pool.
# TYPE dsa_db_pool_total_connections gauge
dsa_db_pool_total_connections 20

# HELP dsa_db_pool_waiting_clients Number of queries queued waiting for a free connection.
# TYPE dsa_db_pool_waiting_clients gauge
dsa_db_pool_waiting_clients 0

# HELP dsa_sync_ops_total Total sync operations processed by the sync engine.
# TYPE dsa_sync_ops_total counter
dsa_sync_ops_total{status="applied"} 1420
dsa_sync_ops_total{status="rejected"} 12
dsa_sync_ops_total{status="conflict"} 3
```

---

## 2. Health Probes Specification

```mermaid
flowchart TD
    Orchestrator["Orchestrator (Docker / K8s / Fly.io)"]
    Orchestrator -->|GET /health/live (every 5s)| Live["Liveness Probe (Process Up)"]
    Orchestrator -->|GET /health/ready (every 10s)| Ready["Readiness Probe (DB Pool Ping)"]
    Ready -->|SELECT 1| PG[(PostgreSQL Pool)]
```

- **`GET /health/live`**: Fast memory/uptime check returning 200 OK. Restarts the container if unresponsive.
- **`GET /health/ready`**: Verifies database socket connectivity, connection pool exhaustion, and query roundtrip time. Returns 503 Service Unavailable if PostgreSQL is unreachable.

---

## 3. Production Alerting Rules

| Alert Rule | Condition | Duration | Severity | Action |
| :--- | :--- | :--- | :--- | :--- |
| `PostgresPoolSaturation` | `dsa_db_pool_waiting_clients > 5` | 1 min | Critical | Scale pool `max: 20` or investigate long-running locks in `pg_stat_activity`. |
| `DatabaseDown` | Readiness check failure | 30 sec | Disaster | Trigger failover / auto-restart PostgreSQL container. |
| `HighQueryLatency` | Query latency > 250ms | 2 min | Warning | Inspect `pg_stat_statements` or refresh Materialized View. |
| `ExcessiveSyncConflicts` | Conflicts rate > 10/sec | 3 min | Warning | Investigate clock drift on client devices. |
