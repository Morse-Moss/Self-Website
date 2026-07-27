ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_conversation_id_id_key
  UNIQUE (conversation_id, id);

ALTER TABLE conversations
  ADD COLUMN context_pipeline_assignment text NOT NULL DEFAULT 'legacy'
    CHECK (context_pipeline_assignment IN (
      'legacy', 'context_packet_v22', 'legacy_locked_after_v22'
    ));

ALTER TABLE interaction_turns
  ADD COLUMN execution_pipeline text
    CHECK (
      execution_pipeline IS NULL
      OR execution_pipeline IN ('legacy_v1', 'legacy_v2', 'safe', 'context_packet_v22')
    ),
  ADD COLUMN semantic_intent text
    CHECK (
      semantic_intent IS NULL
      OR semantic_intent IN (
        'identity_fact', 'project_catalog', 'project_fit', 'named_project_fact',
        'capability_fact', 'jd_match', 'recruitment_intake',
        'unsupported_personal_history', 'external_current',
        'general_conversation', 'clarify'
      )
    ),
  ADD COLUMN discourse_action text
    CHECK (
      discourse_action IS NULL
      OR discourse_action IN ('follow_up', 'correction', 'new_task', 'one_shot')
    ),
  ADD COLUMN task_action text
    CHECK (
      task_action IS NULL
      OR task_action IN ('create', 'continue', 'switch', 'temporary', 'wait', 'complete')
    ),
  ADD COLUMN context_scope_id uuid,
  ADD COLUMN context_manifest jsonb
    CHECK (context_manifest IS NULL OR jsonb_typeof(context_manifest) = 'object');

CREATE INDEX interaction_turns_context_pipeline_status_created_idx
  ON interaction_turns (execution_pipeline, status, created_at DESC)
  WHERE execution_pipeline IS NOT NULL;

CREATE INDEX interaction_turns_context_scope_status_created_idx
  ON interaction_turns (conversation_id, context_scope_id, status, created_at)
  WHERE context_scope_id IS NOT NULL;

CREATE TABLE conversation_context_task_state (
  conversation_id uuid PRIMARY KEY
    REFERENCES conversations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL UNIQUE,
  owner_pipeline text NOT NULL DEFAULT 'context_packet_v22'
    CHECK (owner_pipeline = 'context_packet_v22'),
  task_kind text NOT NULL
    CHECK (task_kind IN (
      'recruitment_evaluation', 'project_discussion',
      'capability_verification', 'jd_match', 'external_research'
    )),
  subject_kind text NOT NULL
    CHECK (subject_kind IN ('morse', 'portfolio', 'project', 'capability', 'external')),
  subject_ref text NOT NULL CHECK (char_length(subject_ref) BETWEEN 1 AND 160),
  evidence_topic_kind text NOT NULL DEFAULT 'none'
    CHECK (evidence_topic_kind IN ('project', 'capability', 'jd', 'external', 'none')),
  evidence_topic_ref text CHECK (evidence_topic_ref IS NULL OR char_length(evidence_topic_ref) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'waiting_input', 'completed')),
  closed_reason text
    CHECK (closed_reason IS NULL OR closed_reason IN ('task_complete', 'pipeline_rollback')),
  waiting_for text[] NOT NULL DEFAULT '{}'
    CHECK (waiting_for <@ ARRAY['company', 'role', 'job_description', 'relevance_referent']::text[]),
  task_started_message_id bigint NOT NULL,
  last_successful_message_id bigint NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_message_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, task_id),
  FOREIGN KEY (conversation_id, task_started_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (conversation_id, last_successful_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (conversation_id, updated_by_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (evidence_topic_kind = 'none' AND evidence_topic_ref IS NULL)
    OR (evidence_topic_kind <> 'none')
  ),
  CHECK (
    (status = 'waiting_input' AND cardinality(waiting_for) > 0)
    OR (status <> 'waiting_input' AND cardinality(waiting_for) = 0)
  ),
  CHECK (
    (status = 'completed' AND closed_reason IS NOT NULL)
    OR (status <> 'completed' AND closed_reason IS NULL)
  )
);

CREATE TABLE conversation_context_slot_refs (
  conversation_id uuid NOT NULL,
  task_id uuid NOT NULL,
  slot_kind text NOT NULL CHECK (slot_kind IN ('company', 'role', 'job_description')),
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 7),
  source_message_id bigint NOT NULL,
  start_utf16 integer NOT NULL CHECK (start_utf16 >= 0),
  end_utf16 integer NOT NULL CHECK (end_utf16 > start_utf16),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  extractor_version text NOT NULL DEFAULT 'recruitment-slots-v1'
    CHECK (extractor_version = 'recruitment-slots-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, task_id, slot_kind, ordinal),
  FOREIGN KEY (conversation_id, task_id)
    REFERENCES conversation_context_task_state(conversation_id, task_id)
    ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, source_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK (slot_kind = 'job_description' OR ordinal = 0)
);

CREATE INDEX conversation_context_slot_refs_source_idx
  ON conversation_context_slot_refs (conversation_id, source_message_id);

CREATE TABLE conversation_context_completed_turns (
  conversation_id uuid NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  context_scope_id uuid NOT NULL,
  user_message_id bigint NOT NULL,
  assistant_message_id bigint NOT NULL,
  owner_pipeline text NOT NULL DEFAULT 'context_packet_v22'
    CHECK (owner_pipeline = 'context_packet_v22'),
  pipeline_version text NOT NULL DEFAULT 'context-packet-v22'
    CHECK (pipeline_version = 'context-packet-v22'),
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, turn_id),
  UNIQUE (conversation_id, user_message_id),
  UNIQUE (conversation_id, assistant_message_id),
  FOREIGN KEY (conversation_id, user_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (conversation_id, assistant_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX conversation_context_completed_turns_scope_completed_idx
  ON conversation_context_completed_turns
  (conversation_id, context_scope_id, completed_at, turn_id);

CREATE TABLE conversation_context_legacy_bridge_turns (
  conversation_id uuid NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 5),
  bridge_version text NOT NULL DEFAULT 'legacy-discourse-bridge-v1'
    CHECK (bridge_version = 'legacy-discourse-bridge-v1'),
  legacy_turn_id uuid NOT NULL,
  user_message_id bigint NOT NULL,
  assistant_message_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured', 'consumed', 'invalidated')),
  captured_at timestamptz NOT NULL,
  resolved_by_turn_id uuid,
  resolved_at timestamptz,
  PRIMARY KEY (conversation_id, ordinal),
  UNIQUE (conversation_id, legacy_turn_id),
  UNIQUE (conversation_id, user_message_id),
  UNIQUE (conversation_id, assistant_message_id),
  FOREIGN KEY (conversation_id, user_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (conversation_id, assistant_message_id)
    REFERENCES conversation_messages(conversation_id, id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (status = 'captured' AND resolved_by_turn_id IS NULL AND resolved_at IS NULL)
    OR (status <> 'captured' AND resolved_by_turn_id IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

ALTER TABLE chat_provider_attempts
  ADD COLUMN context_builder_version text
    CHECK (context_builder_version IS NULL OR context_builder_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  ADD COLUMN packet_hmac_key_id text
    CHECK (packet_hmac_key_id IS NULL OR packet_hmac_key_id ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  ADD COLUMN packet_hmac_sha256 char(64)
    CHECK (packet_hmac_sha256 IS NULL OR packet_hmac_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN generation_overlay_version text
    CHECK (generation_overlay_version IS NULL OR generation_overlay_version = 'strict-overlay-v1'),
  ADD COLUMN generation_request_hmac_sha256 char(64)
    CHECK (
      generation_request_hmac_sha256 IS NULL
      OR generation_request_hmac_sha256 ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE interaction_provider_attempts
  ADD COLUMN context_builder_version text
    CHECK (context_builder_version IS NULL OR context_builder_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  ADD COLUMN packet_hmac_key_id text
    CHECK (packet_hmac_key_id IS NULL OR packet_hmac_key_id ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  ADD COLUMN packet_hmac_sha256 char(64)
    CHECK (packet_hmac_sha256 IS NULL OR packet_hmac_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN generation_overlay_version text
    CHECK (generation_overlay_version IS NULL OR generation_overlay_version = 'strict-overlay-v1'),
  ADD COLUMN generation_request_hmac_sha256 char(64)
    CHECK (
      generation_request_hmac_sha256 IS NULL
      OR generation_request_hmac_sha256 ~ '^[0-9a-f]{64}$'
    );
