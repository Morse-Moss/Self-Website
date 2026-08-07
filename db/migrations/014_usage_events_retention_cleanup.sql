BEGIN;

ALTER TABLE usage_events
  DROP CONSTRAINT usage_events_interaction_turn_id_fkey;

COMMIT;
