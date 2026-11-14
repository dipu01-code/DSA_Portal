-- Migration 004: Least-Privilege Security Roles and Audit Log Immutability

-- 1. Create Least-Privilege Roles if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_app') THEN
        CREATE ROLE dsa_app WITH LOGIN PASSWORD 'dsa_app_secure_pass';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_worker') THEN
        CREATE ROLE dsa_worker WITH LOGIN PASSWORD 'dsa_worker_secure_pass';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dsa_readonly') THEN
        CREATE ROLE dsa_readonly WITH LOGIN PASSWORD 'dsa_readonly_secure_pass';
    END IF;
END
$$;

-- 2. Schema Permissions for dsa_app (Web API)
GRANT USAGE ON SCHEMA public TO dsa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dsa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsa_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dsa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dsa_app;

-- 3. Schema Permissions for dsa_worker (Background Worker)
GRANT USAGE ON SCHEMA public TO dsa_worker;
GRANT SELECT ON problems, test_cases, solutions TO dsa_worker;
GRANT SELECT, UPDATE ON submissions TO dsa_worker;
GRANT SELECT, INSERT, UPDATE ON user_problem_stats TO dsa_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsa_worker;

-- 4. Schema Permissions for dsa_readonly (Read-Only / Backups / Metrics)
GRANT USAGE ON SCHEMA public TO dsa_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dsa_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dsa_readonly;

-- 5. Immutability Protection for audit_log (Prevent Tampering)
CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: audit_log is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW
EXECUTE FUNCTION protect_audit_log();
