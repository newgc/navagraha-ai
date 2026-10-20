-- D-04 §1 rule 6 / NFR-10: audit and state-transition history is append-only.
-- Corrections are new rows; nothing may rewrite or delete history.
CREATE OR REPLACE FUNCTION reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER state_transition_append_only
  BEFORE UPDATE OR DELETE ON state_transition
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER state_transition_no_truncate
  BEFORE TRUNCATE ON state_transition
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_history_mutation();
