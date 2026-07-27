DO $$
DECLARE
  task_state_columns text[];
  turn_has_task_id boolean;
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
    INTO task_state_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'conversation_task_state';

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'interaction_turns'
       AND column_name = 'task_id'
  ) INTO turn_has_task_id;

  IF task_state_columns = ARRAY[
    'conversation_id',
    'task_id',
    'task_kind',
    'topic_kind',
    'topic_ref',
    'status',
    'waiting_for',
    'task_started_turn_id',
    'last_successful_turn_id',
    'version',
    'updated_by_turn_id',
    'created_at',
    'updated_at'
  ]::text[] THEN
    IF NOT turn_has_task_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'MORSE_TASK_STATE_SCHEMA_UNSUPPORTED';
    END IF;
    RETURN;
  END IF;

  IF task_state_columns IS DISTINCT FROM ARRAY[
    'conversation_id',
    'active_topic_kind',
    'active_topic_ref',
    'status',
    'version',
    'updated_by_turn_id',
    'updated_at'
  ]::text[] OR turn_has_task_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'MORSE_TASK_STATE_SCHEMA_UNSUPPORTED';
  END IF;

  ALTER TABLE interaction_turns
    ADD COLUMN task_id uuid;

  ALTER TABLE conversation_task_state
    ADD COLUMN task_id uuid,
    ADD COLUMN task_kind text,
    ADD COLUMN topic_kind text,
    ADD COLUMN topic_ref text,
    ADD COLUMN waiting_for text[] NOT NULL DEFAULT '{}',
    ADD COLUMN task_started_turn_id uuid,
    ADD COLUMN last_successful_turn_id uuid,
    ADD COLUMN created_at timestamptz;

  DELETE FROM conversation_task_state
   WHERE active_topic_kind = 'none'
      OR active_topic_ref IS NULL
      OR (status = 'waiting_input' AND active_topic_kind <> 'jd');

  UPDATE conversation_task_state
     SET task_id = gen_random_uuid(),
         task_kind = CASE active_topic_kind
           WHEN 'project' THEN 'project_discussion'
           WHEN 'capability' THEN 'capability_verification'
           WHEN 'jd' THEN 'jd_match'
           WHEN 'external' THEN 'external_research'
         END,
         topic_kind = active_topic_kind,
         topic_ref = active_topic_ref,
         waiting_for = CASE
           WHEN status = 'waiting_input' THEN ARRAY['job_description']::text[]
           ELSE '{}'::text[]
         END,
         task_started_turn_id = updated_by_turn_id,
         last_successful_turn_id = updated_by_turn_id,
         created_at = updated_at;

  UPDATE interaction_turns AS turn_record
     SET task_id = task_state.task_id
    FROM conversation_task_state AS task_state
   WHERE turn_record.id = task_state.updated_by_turn_id;

  ALTER TABLE conversation_task_state
    DROP CONSTRAINT conversation_task_state_active_topic_kind_check,
    DROP CONSTRAINT conversation_task_state_active_topic_ref_check,
    DROP CONSTRAINT conversation_task_state_check,
    DROP CONSTRAINT conversation_task_state_status_check,
    DROP CONSTRAINT conversation_task_state_version_check,
    DROP COLUMN active_topic_kind,
    DROP COLUMN active_topic_ref,
    ALTER COLUMN task_id SET NOT NULL,
    ALTER COLUMN task_kind SET NOT NULL,
    ALTER COLUMN topic_kind SET NOT NULL,
    ALTER COLUMN topic_ref SET NOT NULL,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now(),
    ADD CONSTRAINT conversation_task_state_task_id_key UNIQUE (task_id),
    ADD CONSTRAINT conversation_task_state_task_kind_check
      CHECK (task_kind IN (
        'project_discussion',
        'capability_verification',
        'jd_match',
        'external_research'
      )),
    ADD CONSTRAINT conversation_task_state_topic_kind_check
      CHECK (topic_kind IN ('project', 'capability', 'jd', 'external')),
    ADD CONSTRAINT conversation_task_state_topic_ref_check
      CHECK (char_length(topic_ref) BETWEEN 1 AND 160),
    ADD CONSTRAINT conversation_task_state_status_check
      CHECK (status IN ('active', 'waiting_input', 'completed')),
    ADD CONSTRAINT conversation_task_state_waiting_for_check
      CHECK (waiting_for <@ ARRAY['job_description']::text[]),
    ADD CONSTRAINT conversation_task_state_version_check
      CHECK (version > 0),
    ADD CONSTRAINT conversation_task_state_waiting_status_check
      CHECK (
        (status = 'waiting_input' AND cardinality(waiting_for) > 0)
        OR (status <> 'waiting_input' AND cardinality(waiting_for) = 0)
      ),
    ADD CONSTRAINT conversation_task_state_task_topic_check
      CHECK (
        (task_kind = 'project_discussion' AND topic_kind = 'project')
        OR (task_kind = 'capability_verification' AND topic_kind = 'capability')
        OR (task_kind = 'jd_match' AND topic_kind = 'jd')
        OR (task_kind = 'external_research' AND topic_kind = 'external')
      ),
    ADD CONSTRAINT conversation_task_state_task_started_turn_id_fkey
      FOREIGN KEY (task_started_turn_id)
      REFERENCES interaction_turns(id) ON DELETE SET NULL,
    ADD CONSTRAINT conversation_task_state_last_successful_turn_id_fkey
      FOREIGN KEY (last_successful_turn_id)
      REFERENCES interaction_turns(id) ON DELETE SET NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS interaction_turns_conversation_task_status_created_idx
  ON interaction_turns (conversation_id, task_id, status, created_at);
