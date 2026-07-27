ALTER TABLE interaction_turns
  ADD COLUMN task_id uuid;

CREATE INDEX interaction_turns_conversation_task_status_created_idx
  ON interaction_turns (conversation_id, task_id, status, created_at);

CREATE TABLE conversation_task_state (
  conversation_id uuid PRIMARY KEY
    REFERENCES conversations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL UNIQUE,
  task_kind text NOT NULL
    CHECK (task_kind IN (
      'project_discussion',
      'capability_verification',
      'jd_match',
      'external_research'
    )),
  topic_kind text NOT NULL
    CHECK (topic_kind IN ('project', 'capability', 'jd', 'external')),
  topic_ref text NOT NULL
    CHECK (char_length(topic_ref) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'waiting_input', 'completed')),
  waiting_for text[] NOT NULL DEFAULT '{}'
    CHECK (waiting_for <@ ARRAY['job_description']::text[]),
  task_started_turn_id uuid
    REFERENCES interaction_turns(id) ON DELETE SET NULL,
  last_successful_turn_id uuid
    REFERENCES interaction_turns(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_turn_id uuid
    REFERENCES interaction_turns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'waiting_input' AND cardinality(waiting_for) > 0)
    OR (status <> 'waiting_input' AND cardinality(waiting_for) = 0)
  ),
  CHECK (
    (task_kind = 'project_discussion' AND topic_kind = 'project')
    OR (task_kind = 'capability_verification' AND topic_kind = 'capability')
    OR (task_kind = 'jd_match' AND topic_kind = 'jd')
    OR (task_kind = 'external_research' AND topic_kind = 'external')
  )
);
