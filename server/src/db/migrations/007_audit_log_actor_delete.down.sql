-- Revert Migration 007: back to 004's strict append-only trigger function.
CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security Policy Violation: audit_log is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;
