-- Migration 007: let user deletion clear audit_log.actor_id (CR-029).
-- 001 declares actor_id ON DELETE SET NULL, which is an UPDATE; 004's append-only trigger
-- rejected it, so no user with audit rows could be deleted. Allow exactly that one change.

CREATE OR REPLACE FUNCTION protect_audit_log()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.actor_id IS NOT NULL
       AND NEW.actor_id IS NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Security Policy Violation: audit_log is append-only. UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;
