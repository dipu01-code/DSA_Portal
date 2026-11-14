# Operations & Incident Response Runbook — DSA Practice Platform

## 1. Incident: PostgreSQL Connection Pool Saturation
### Symptoms
- Alert: `PostgresPoolSaturation` firing.
- Metric: `dsa_db_pool_waiting_clients > 5`.
- Symptoms: API latency spiking, HTTP 500/504 errors on `/api/v1/*`.

### Diagnostic Steps
1. Inspect live database connections and running queries:
   ```sql
   SELECT pid, usename, state, query_start, now() - query_start AS duration, query
   FROM pg_stat_activity
   WHERE state != 'idle'
   ORDER BY duration DESC;
   ```
2. Identify queries stuck in `idle in transaction` holding row locks:
   ```sql
   SELECT pid, state, now() - state_change AS idle_duration, query
   FROM pg_stat_activity
   WHERE state = 'idle in transaction'
   ORDER BY idle_duration DESC;
   ```

### Resolution
1. Terminate offending blocked backend query:
   ```sql
   SELECT pg_terminate_backend(<pid>);
   ```
2. If pool limit is structurally exhausted under high legitimate load, adjust `MAX_CONNECTIONS` in `server/src/db/pool.ts` and restart container.

---

## 2. Incident: Database Outage / Unreachable
### Symptoms
- Probe: `GET /health/ready` returns 503.
- Alert: `DatabaseDown` firing.

### Resolution
1. Check container status:
   ```bash
   docker compose -f infra/docker-compose.prod.yml ps postgres
   ```
2. View database crash logs:
   ```bash
   docker compose -f infra/docker-compose.prod.yml logs --tail=100 postgres
   ```
3. Restart PostgreSQL service:
   ```bash
   docker compose -f infra/docker-compose.prod.yml restart postgres
   ```
4. If storage volume is corrupted, trigger disaster recovery restore:
   ```bash
   npm run db:restore
   ```

---

## 3. Incident: Stale Leaderboard Cache / Desynchronized Ranks
### Resolution
Trigger a concurrent background refresh of the leaderboard materialized view:
```bash
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U postgres -d dsa_portal -c "CALL refresh_leaderboard(true);"
```
