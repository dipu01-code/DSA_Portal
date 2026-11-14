# Handover — Day 8, Person 2

## What was built

Day 8 delivers comprehensive database backup automation, disaster recovery procedures, and database security hardening:

1. **Automated Backup & Retention Service (`scripts/backup-service.ts`, `scripts/backup-db.ts`, `scripts/backup-db.sh`)**:
   - Gzip-compressed backups with automated SHA-256 integrity checksums.
   - Manifest creation (`.manifest.json`) capturing timestamp, database, file size, hash, and table row counts.
   - Retention rotation: automatically identifies and prunes backup archives older than `BACKUP_RETENTION_DAYS` (default 7 days).
   - Added `npm run db:backup` script.
2. **Integrity-Verified Restore Automation (`scripts/restore-db.ts`, `scripts/restore-db.sh`)**:
   - Cryptographic pre-restore verification: validates checksum against manifest before modifying any database tables.
   - Post-restore smoke validation: queries PostgreSQL row counts to verify data integrity.
   - Added `npm run db:restore` script.
3. **Migration 004: Least-Privilege Security Roles & Audit Immutability**:
   - PostgreSQL roles: `dsa_app` (Fastify API), `dsa_worker` (BullMQ workers), `dsa_readonly` (Metrics and backups).
   - Tamper-proofing trigger `trg_audit_log_immutable` on `audit_log` ensuring strict append-only non-repudiation.
4. **Documentation**:
   - `docs/db/backup-and-dr.md`: DR playbook, RPO (< 1 hr) and RTO (< 5 mins) targets, restoration steps.
   - `docs/db/security-hardening.md`: RBAC security matrix and audit log policies.
5. **Automated Tests**:
   - `core/__tests__/db/backup-restore.test.ts`: Checksum generation, tamper detection, manifest sorting, and retention pruning.
   - `server/__tests__/security-roles.test.ts`: Role verification and audit log immutability triggers.

---

## How to Run & Verify

### 1. Execute Backup

```bash
npm run db:backup
```

### 2. Execute Restore

```bash
npm run db:restore
```

### 3. Run Test Suite

```bash
npm test -- core/__tests__/db/backup-restore.test.ts server/__tests__/security-roles.test.ts
```

---

## Viva Defense (Design Decisions & Trade-offs)

> **Viva Defense — Day 8 Architectural Rationale:**
>
> 1. **Checksum Manifest Pre-Verification**: In disaster scenarios, restoring from a corrupt or truncated backup can leave the database in a half-migrated, unrecoverable state. By computing and verifying SHA-256 before any data is ingested, we guarantee archive authenticity and prevent silent corruption.
> 2. **Database-Level Least-Privilege Roles**: Application-level permission checks (e.g. within Node.js) can be bypassed by SQL injection vulnerabilities or rogue worker processes. Enforcing RBAC at the PostgreSQL catalog level (`dsa_worker` can only SELECT problems and UPDATE submissions) provides true defense-in-depth.
> 3. **Trigger-Based Audit Log Non-Repudiation**: Application logs can be deleted if an attacker gains web shell access. A database-level `BEFORE UPDATE OR DELETE` trigger aborts any modification attempts to `audit_log`, ensuring a tamper-proof audit trail for regulatory compliance.
> 4. **Deterministic Backup Retention Rotation**: Storing indefinite backups causes disk exhaustion, crashing the database engine. Our automated rotation enforces retention periods while keeping sidecar manifests for compliance auditing.
