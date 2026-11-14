# Database Security Hardening & Least-Privilege Guide

## 1. Role-Based Access Control (RBAC) Matrix

| Database Role  | Intended Consumer                               | Schema Permissions | Table Permissions                                                                                     | Rationale                                                                            |
| :------------- | :---------------------------------------------- | :----------------- | :---------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `postgres`     | Database Administrator / Migrations             | `ALL`              | `ALL`                                                                                                 | Schema migrations, index creations, VACUUM ANALYZE.                                  |
| `dsa_app`      | Fastify REST API (`server`)                     | `USAGE`            | `SELECT, INSERT, UPDATE, DELETE` on all tables; `USAGE, SELECT` on sequences; `EXECUTE` on functions  | Full application data lifecycle without DDL or database drop powers.                 |
| `dsa_worker`   | BullMQ Submission Workers (`workers`)           | `USAGE`            | `SELECT` on problems/test_cases/solutions; `SELECT, UPDATE` on submissions; `INSERT, UPDATE` on stats | Sandboxed worker can only judge submissions; cannot modify problems or delete users. |
| `dsa_readonly` | Backup automation, Prometheus metrics, Analysts | `USAGE`            | `SELECT` only on all tables                                                                           | Zero write access; eliminates accidental deletions during reporting or dumps.        |

---

## 2. Non-Repudiation & Audit Log Immutability

To prevent administrative privilege escalation or insider tampering from erasing traces of malicious activity, `audit_log` is guarded by an append-only trigger:

```sql
CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: audit_log is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION protect_audit_log();
```

Any attempt to run `UPDATE audit_log` or `DELETE FROM audit_log` immediately aborts with an uncatchable exception.
