ALTER TABLE ai_model_presets
  DROP CONSTRAINT ai_model_presets_max_output_tokens_check,
  ALTER COLUMN max_output_tokens DROP NOT NULL,
  ADD COLUMN context_window_tokens integer
    CHECK (context_window_tokens IS NULL OR context_window_tokens > 0),
  ADD COLUMN config_digest_version smallint NOT NULL DEFAULT 1
    CHECK (config_digest_version IN (1, 2)),
  ADD CONSTRAINT ai_model_presets_max_output_tokens_positive_check
    CHECK (max_output_tokens IS NULL OR max_output_tokens > 0);

ALTER TABLE ai_route_targets
  ADD COLUMN config_digest_version smallint NOT NULL DEFAULT 1
    CHECK (config_digest_version IN (1, 2)),
  ADD COLUMN context_window_tokens integer
    CHECK (context_window_tokens IS NULL OR context_window_tokens > 0),
  ADD COLUMN max_output_tokens integer
    CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
  ADD COLUMN reasoning_effort varchar(32)
    CHECK (
      reasoning_effort IS NULL
      OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    );

ALTER TABLE ai_environment_takeovers
  ADD COLUMN source_config_digest_version smallint NOT NULL DEFAULT 1
    CHECK (source_config_digest_version IN (1, 2));

CREATE OR REPLACE FUNCTION ai_guard_model_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.series_id, NEW.version, NEW.previous_version_id, NEW.connection_version_id,
    NEW.display_name, NEW.model_id, NEW.protocol, NEW.reasoning_effort,
    NEW.context_window_tokens, NEW.max_output_tokens, NEW.config_digest_version,
    NEW.input_usd_per_million, NEW.output_usd_per_million,
    NEW.config_digest, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.series_id, OLD.version, OLD.previous_version_id, OLD.connection_version_id,
    OLD.display_name, OLD.model_id, OLD.protocol, OLD.reasoning_effort,
    OLD.context_window_tokens, OLD.max_output_tokens, OLD.config_digest_version,
    OLD.input_usd_per_million, OLD.output_usd_per_million,
    OLD.config_digest, OLD.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_MODEL_VERSION_IMMUTABLE';
  END IF;

  IF NOT (
    (NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at)
    OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  ) OR NOT (
    (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_MODEL_LIFECYCLE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_guard_environment_takeover_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(
    NEW.id,
    NEW.request_id,
    NEW.environment_target_key,
    NEW.source_config_digest,
    NEW.source_config_digest_version,
    NEW.initial_connection_version_id,
    NEW.initial_model_version_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.request_id,
    OLD.environment_target_key,
    OLD.source_config_digest,
    OLD.source_config_digest_version,
    OLD.initial_connection_version_id,
    OLD.initial_model_version_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'AI_ENVIRONMENT_TAKEOVER_IMMUTABLE';
  END IF;

  IF NOT (
    NEW.released_at IS NOT DISTINCT FROM OLD.released_at
    OR (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'AI_ENVIRONMENT_TAKEOVER_RELEASE_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE usage_events
  DROP CONSTRAINT usage_events_provider_attempt_fk,
  DROP CONSTRAINT usage_events_provider_attempt_index_check;

ALTER TABLE interaction_provider_attempts
  DROP CONSTRAINT interaction_provider_attempts_attempt_index_check,
  DROP CONSTRAINT interaction_provider_attempts_launch_kind_check;

ALTER TABLE chat_provider_attempts
  DROP CONSTRAINT chat_provider_attempts_attempt_no_check,
  DROP CONSTRAINT chat_provider_attempts_launch_kind_check;

ALTER TABLE chat_provider_attempts
  ADD CONSTRAINT chat_provider_attempts_attempt_no_check
    CHECK (attempt_no BETWEEN 1 AND 7),
  ADD CONSTRAINT chat_provider_attempts_launch_kind_check
    CHECK (launch_kind IN ('primary', 'hedge', 'failover', 'overflow_retry'));

ALTER TABLE interaction_provider_attempts
  ADD CONSTRAINT interaction_provider_attempts_attempt_index_check
    CHECK (attempt_index BETWEEN 0 AND 6),
  ADD CONSTRAINT interaction_provider_attempts_launch_kind_check
    CHECK (
      launch_kind IS NULL
      OR launch_kind IN ('primary', 'hedge', 'failover', 'overflow_retry')
    );

ALTER TABLE usage_events
  ADD CONSTRAINT usage_events_provider_attempt_index_check
    CHECK (provider_attempt_index IS NULL OR provider_attempt_index BETWEEN 0 AND 6),
  ADD CONSTRAINT usage_events_provider_attempt_fk
    FOREIGN KEY (interaction_turn_id, provider_attempt_index)
    REFERENCES interaction_provider_attempts(interaction_turn_id, attempt_index)
    ON DELETE SET NULL;

ALTER TABLE interaction_provider_attempts
  ADD COLUMN generation_variant_id uuid,
  ADD COLUMN generation_variant_revision integer
    CHECK (generation_variant_revision IS NULL OR generation_variant_revision > 0),
  ADD COLUMN generation_variant_trigger text
    CHECK (
      generation_variant_trigger IS NULL
      OR generation_variant_trigger IN ('initial', 'numeric_preflight', 'provider_numeric_overflow')
    ),
  ADD COLUMN target_config_digest_version smallint
    CHECK (target_config_digest_version IS NULL OR target_config_digest_version IN (1, 2)),
  ADD COLUMN target_config_digest char(64)
    CHECK (target_config_digest IS NULL OR target_config_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN target_model_id varchar(512)
    CHECK (
      target_model_id IS NULL
      OR (target_model_id = btrim(target_model_id) AND char_length(target_model_id) BETWEEN 1 AND 512)
    ),
  ADD COLUMN target_protocol varchar(32)
    CHECK (target_protocol IS NULL OR target_protocol IN ('responses', 'chat_completions')),
  ADD COLUMN target_context_window_tokens integer
    CHECK (target_context_window_tokens IS NULL OR target_context_window_tokens > 0),
  ADD COLUMN target_max_output_tokens integer
    CHECK (target_max_output_tokens IS NULL OR target_max_output_tokens > 0),
  ADD COLUMN target_reasoning_effort varchar(32)
    CHECK (
      target_reasoning_effort IS NULL
      OR target_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    ),
  ADD COLUMN provider_failure_category text
    CHECK (
      provider_failure_category IS NULL
      OR provider_failure_category IN (
        'context_overflow', 'output_truncated', 'incomplete', 'provider_failed',
        'transport', 'timeout', 'cancelled'
      )
    ),
  ADD COLUMN provider_http_status smallint
    CHECK (provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
  ADD COLUMN provider_input_tokens integer
    CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  ADD COLUMN provider_context_window_tokens integer
    CHECK (provider_context_window_tokens IS NULL OR provider_context_window_tokens > 0),
  ADD COLUMN provider_output_tokens integer
    CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  ADD COLUMN provider_failure_reason text
    CHECK (
      provider_failure_reason IS NULL
      OR provider_failure_reason IN (
        'http_413', 'context_length_exceeded', 'max_output_tokens', 'length',
        'response_incomplete', 'response_failed', 'stream_failed', 'transport',
        'timeout', 'cancelled'
      )
    ),
  ADD COLUMN generation_request_v2_hmac_sha256 char(64)
    CHECK (
      generation_request_v2_hmac_sha256 IS NULL
      OR generation_request_v2_hmac_sha256 ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT interaction_provider_attempts_v2_identity_check CHECK (
    (
      generation_variant_id IS NULL
      AND generation_variant_revision IS NULL
      AND generation_variant_trigger IS NULL
      AND target_config_digest_version IS NULL
      AND target_config_digest IS NULL
      AND target_model_id IS NULL
      AND target_protocol IS NULL
      AND target_context_window_tokens IS NULL
      AND target_max_output_tokens IS NULL
      AND target_reasoning_effort IS NULL
      AND generation_request_v2_hmac_sha256 IS NULL
      AND provider_failure_category IS NULL
      AND provider_http_status IS NULL
      AND provider_input_tokens IS NULL
      AND provider_context_window_tokens IS NULL
      AND provider_output_tokens IS NULL
      AND provider_failure_reason IS NULL
    )
    OR
    (
      generation_variant_id IS NOT NULL
      AND generation_variant_revision IS NOT NULL
      AND generation_variant_trigger IS NOT NULL
      AND target_config_digest_version IS NOT NULL
      AND target_config_digest IS NOT NULL
      AND target_model_id IS NOT NULL
      AND target_protocol IS NOT NULL
      AND packet_hmac_key_id IS NOT NULL
      AND packet_hmac_sha256 IS NOT NULL
      AND generation_request_v2_hmac_sha256 IS NOT NULL
      AND (
        (provider_failure_category IS NULL
          AND provider_http_status IS NULL
          AND provider_input_tokens IS NULL
          AND provider_context_window_tokens IS NULL
          AND provider_output_tokens IS NULL
          AND provider_failure_reason IS NULL)
        OR
        (provider_failure_category IS NOT NULL AND provider_failure_reason IS NOT NULL)
      )
    )
  );

ALTER TABLE chat_provider_attempts
  ADD COLUMN generation_variant_id uuid,
  ADD COLUMN generation_variant_revision integer
    CHECK (generation_variant_revision IS NULL OR generation_variant_revision > 0),
  ADD COLUMN generation_variant_trigger text
    CHECK (
      generation_variant_trigger IS NULL
      OR generation_variant_trigger IN ('initial', 'numeric_preflight', 'provider_numeric_overflow')
    ),
  ADD COLUMN target_config_digest_version smallint
    CHECK (target_config_digest_version IS NULL OR target_config_digest_version IN (1, 2)),
  ADD COLUMN target_config_digest char(64)
    CHECK (target_config_digest IS NULL OR target_config_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN target_model_id varchar(512)
    CHECK (
      target_model_id IS NULL
      OR (target_model_id = btrim(target_model_id) AND char_length(target_model_id) BETWEEN 1 AND 512)
    ),
  ADD COLUMN target_protocol varchar(32)
    CHECK (target_protocol IS NULL OR target_protocol IN ('responses', 'chat_completions')),
  ADD COLUMN target_context_window_tokens integer
    CHECK (target_context_window_tokens IS NULL OR target_context_window_tokens > 0),
  ADD COLUMN target_max_output_tokens integer
    CHECK (target_max_output_tokens IS NULL OR target_max_output_tokens > 0),
  ADD COLUMN target_reasoning_effort varchar(32)
    CHECK (
      target_reasoning_effort IS NULL
      OR target_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    ),
  ADD COLUMN provider_failure_category text
    CHECK (
      provider_failure_category IS NULL
      OR provider_failure_category IN (
        'context_overflow', 'output_truncated', 'incomplete', 'provider_failed',
        'transport', 'timeout', 'cancelled'
      )
    ),
  ADD COLUMN provider_http_status smallint
    CHECK (provider_http_status IS NULL OR provider_http_status BETWEEN 100 AND 599),
  ADD COLUMN provider_input_tokens integer
    CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  ADD COLUMN provider_context_window_tokens integer
    CHECK (provider_context_window_tokens IS NULL OR provider_context_window_tokens > 0),
  ADD COLUMN provider_output_tokens integer
    CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  ADD COLUMN provider_failure_reason text
    CHECK (
      provider_failure_reason IS NULL
      OR provider_failure_reason IN (
        'http_413', 'context_length_exceeded', 'max_output_tokens', 'length',
        'response_incomplete', 'response_failed', 'stream_failed', 'transport',
        'timeout', 'cancelled'
      )
    ),
  ADD COLUMN generation_request_v2_hmac_sha256 char(64)
    CHECK (
      generation_request_v2_hmac_sha256 IS NULL
      OR generation_request_v2_hmac_sha256 ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT chat_provider_attempts_v2_identity_check CHECK (
    (
      generation_variant_id IS NULL
      AND generation_variant_revision IS NULL
      AND generation_variant_trigger IS NULL
      AND target_config_digest_version IS NULL
      AND target_config_digest IS NULL
      AND target_model_id IS NULL
      AND target_protocol IS NULL
      AND target_context_window_tokens IS NULL
      AND target_max_output_tokens IS NULL
      AND target_reasoning_effort IS NULL
      AND generation_request_v2_hmac_sha256 IS NULL
      AND provider_failure_category IS NULL
      AND provider_http_status IS NULL
      AND provider_input_tokens IS NULL
      AND provider_context_window_tokens IS NULL
      AND provider_output_tokens IS NULL
      AND provider_failure_reason IS NULL
    )
    OR
    (
      generation_variant_id IS NOT NULL
      AND generation_variant_revision IS NOT NULL
      AND generation_variant_trigger IS NOT NULL
      AND target_config_digest_version IS NOT NULL
      AND target_config_digest IS NOT NULL
      AND target_model_id IS NOT NULL
      AND target_protocol IS NOT NULL
      AND packet_hmac_key_id IS NOT NULL
      AND packet_hmac_sha256 IS NOT NULL
      AND generation_request_v2_hmac_sha256 IS NOT NULL
      AND (
        (provider_failure_category IS NULL
          AND provider_http_status IS NULL
          AND provider_input_tokens IS NULL
          AND provider_context_window_tokens IS NULL
          AND provider_output_tokens IS NULL
          AND provider_failure_reason IS NULL)
        OR
        (provider_failure_category IS NOT NULL AND provider_failure_reason IS NOT NULL)
      )
    )
  );

ALTER TABLE conversation_context_legacy_bridge_turns
  DROP CONSTRAINT conversation_context_legacy_bridge_turns_ordinal_check,
  ALTER COLUMN ordinal TYPE integer,
  ADD CONSTRAINT conversation_context_legacy_bridge_turns_ordinal_check
    CHECK (ordinal >= 0);

CREATE TABLE chat_history_summary_attempts (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  interaction_turn_id uuid NOT NULL REFERENCES interaction_turns(id) ON DELETE CASCADE,
  context_scope_id uuid,
  owner_pipeline text NOT NULL
    CHECK (owner_pipeline IN ('legacy_v1', 'legacy_v2', 'context_packet_v22')),
  call_index integer NOT NULL CHECK (call_index >= 0),
  generation_variant_id uuid NOT NULL,
  generation_variant_revision integer NOT NULL CHECK (generation_variant_revision > 0),
  previous_compaction_id uuid,
  trigger_reason text NOT NULL
    CHECK (trigger_reason IN ('numeric_preflight', 'provider_numeric_overflow')),
  summary_instruction_version varchar(64) NOT NULL
    CHECK (summary_instruction_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  source_turn_ids uuid[] NOT NULL CHECK (cardinality(source_turn_ids) > 0),
  source_turn_sha256 char(64) NOT NULL CHECK (source_turn_sha256 ~ '^[0-9a-f]{64}$'),
  target_config_digest_version smallint NOT NULL
    CHECK (target_config_digest_version IN (1, 2)),
  target_config_digest char(64) NOT NULL
    CHECK (target_config_digest ~ '^[0-9a-f]{64}$'),
  target_model_id varchar(512) NOT NULL
    CHECK (target_model_id = btrim(target_model_id) AND char_length(target_model_id) BETWEEN 1 AND 512),
  target_protocol varchar(32) NOT NULL
    CHECK (target_protocol IN ('responses', 'chat_completions')),
  target_context_window_tokens integer NOT NULL CHECK (target_context_window_tokens > 0),
  target_max_output_tokens integer
    CHECK (target_max_output_tokens IS NULL OR target_max_output_tokens > 0),
  target_reasoning_effort varchar(32)
    CHECK (
      target_reasoning_effort IS NULL
      OR target_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    ),
  summary_request_hmac_key_id text NOT NULL
    CHECK (summary_request_hmac_key_id ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
  summary_request_hmac_sha256 char(64) NOT NULL
    CHECK (summary_request_hmac_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'cancelled')),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  delete_after timestamptz NOT NULL,
  UNIQUE (interaction_turn_id, call_index),
  CHECK (
    (status = 'started' AND completed_at IS NULL AND error_code IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL AND error_code IS NULL)
    OR (status IN ('failed', 'cancelled') AND completed_at IS NOT NULL)
  ),
  CHECK (delete_after = started_at + interval '10 days')
);

CREATE TABLE conversation_history_compactions (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  context_scope_id uuid,
  owner_pipeline text NOT NULL
    CHECK (owner_pipeline IN ('legacy_v1', 'legacy_v2', 'context_packet_v22')),
  previous_compaction_id uuid,
  source_turn_ids uuid[] NOT NULL CHECK (cardinality(source_turn_ids) > 0),
  source_turn_sha256 char(64) NOT NULL CHECK (source_turn_sha256 ~ '^[0-9a-f]{64}$'),
  summary_text text NOT NULL CHECK (char_length(summary_text) > 0),
  summary_attempt_id uuid NOT NULL UNIQUE,
  trigger_reason text NOT NULL
    CHECK (trigger_reason IN ('numeric_preflight', 'provider_numeric_overflow')),
  summary_instruction_version varchar(64) NOT NULL
    CHECK (summary_instruction_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  target_config_digest_version smallint NOT NULL
    CHECK (target_config_digest_version IN (1, 2)),
  target_config_digest char(64) NOT NULL
    CHECK (target_config_digest ~ '^[0-9a-f]{64}$'),
  target_model_id varchar(512) NOT NULL
    CHECK (target_model_id = btrim(target_model_id) AND char_length(target_model_id) BETWEEN 1 AND 512),
  target_protocol varchar(32) NOT NULL
    CHECK (target_protocol IN ('responses', 'chat_completions')),
  target_context_window_tokens integer NOT NULL CHECK (target_context_window_tokens > 0),
  target_max_output_tokens integer
    CHECK (target_max_output_tokens IS NULL OR target_max_output_tokens > 0),
  target_reasoning_effort varchar(32)
    CHECK (
      target_reasoning_effort IS NULL
      OR target_reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')
    ),
  generation_variant_id uuid NOT NULL,
  generation_variant_revision integer NOT NULL CHECK (generation_variant_revision > 0),
  created_at timestamptz NOT NULL,
  delete_after timestamptz NOT NULL,
  CONSTRAINT conversation_history_compactions_summary_attempt_id_fkey
    FOREIGN KEY (summary_attempt_id)
    REFERENCES chat_history_summary_attempts(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CHECK (delete_after = created_at + interval '10 days')
);

CREATE INDEX chat_history_summary_attempts_delete_after_idx
  ON chat_history_summary_attempts(delete_after);
CREATE INDEX conversation_history_compactions_delete_after_idx
  ON conversation_history_compactions(delete_after);
CREATE INDEX conversation_history_compactions_reuse_idx
  ON conversation_history_compactions(
    conversation_id, context_scope_id, owner_pipeline, source_turn_sha256,
    target_config_digest_version, target_config_digest, created_at DESC, id DESC
  );

CREATE FUNCTION chat_history_privacy_purge_allowed(target_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  marker text;
  marker_id uuid;
  owner_name name;
BEGIN
  marker := current_setting('morse.privacy_purge_session_id', true);
  IF marker IS NULL OR marker = '' THEN
    RETURN false;
  END IF;
  marker_id := marker::uuid;
  SELECT pg_get_userbyid(relation.relowner)
    INTO owner_name
    FROM pg_class AS relation
   WHERE relation.oid = 'public.access_sessions'::regclass;
  IF current_user <> owner_name THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.access_sessions WHERE id = marker_id) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.conversations
     WHERE id = target_conversation_id
       AND access_session_id IS DISTINCT FROM marker_id
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false;
END;
$$;

CREATE FUNCTION chat_history_guard_summary_attempt_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'started'
      OR NEW.completed_at IS NOT NULL
      OR NEW.error_code IS NOT NULL
      OR NEW.input_tokens IS NOT NULL
      OR NEW.output_tokens IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_SUMMARY_ATTEMPT_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'started'
      OR NEW.status NOT IN ('completed', 'failed', 'cancelled')
      OR ROW(
        NEW.id, NEW.conversation_id, NEW.interaction_turn_id, NEW.context_scope_id,
        NEW.owner_pipeline, NEW.call_index, NEW.generation_variant_id,
        NEW.generation_variant_revision, NEW.previous_compaction_id, NEW.trigger_reason,
        NEW.summary_instruction_version, NEW.source_turn_ids, NEW.source_turn_sha256,
        NEW.target_config_digest_version, NEW.target_config_digest, NEW.target_model_id,
        NEW.target_protocol, NEW.target_context_window_tokens, NEW.target_max_output_tokens,
        NEW.target_reasoning_effort, NEW.summary_request_hmac_key_id,
        NEW.summary_request_hmac_sha256, NEW.started_at, NEW.delete_after
      ) IS DISTINCT FROM ROW(
        OLD.id, OLD.conversation_id, OLD.interaction_turn_id, OLD.context_scope_id,
        OLD.owner_pipeline, OLD.call_index, OLD.generation_variant_id,
        OLD.generation_variant_revision, OLD.previous_compaction_id, OLD.trigger_reason,
        OLD.summary_instruction_version, OLD.source_turn_ids, OLD.source_turn_sha256,
        OLD.target_config_digest_version, OLD.target_config_digest, OLD.target_model_id,
        OLD.target_protocol, OLD.target_context_window_tokens, OLD.target_max_output_tokens,
        OLD.target_reasoning_effort, OLD.summary_request_hmac_key_id,
        OLD.summary_request_hmac_sha256, OLD.started_at, OLD.delete_after
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_SUMMARY_ATTEMPT_IMMUTABLE';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.delete_after <= clock_timestamp()
    OR public.chat_history_privacy_purge_allowed(OLD.conversation_id)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_SUMMARY_ATTEMPT_RETAINED';
END;
$$;

CREATE TRIGGER chat_history_summary_attempts_mutation_guard
BEFORE INSERT OR UPDATE OR DELETE ON chat_history_summary_attempts
FOR EACH ROW EXECUTE FUNCTION chat_history_guard_summary_attempt_mutation();

CREATE FUNCTION chat_history_guard_compaction_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.chat_history_summary_attempts AS attempt
       WHERE attempt.id = NEW.summary_attempt_id
         AND attempt.status = 'completed'
         AND attempt.conversation_id = NEW.conversation_id
         AND attempt.context_scope_id IS NOT DISTINCT FROM NEW.context_scope_id
         AND attempt.owner_pipeline = NEW.owner_pipeline
         AND attempt.previous_compaction_id IS NOT DISTINCT FROM NEW.previous_compaction_id
         AND attempt.source_turn_ids = NEW.source_turn_ids
         AND attempt.source_turn_sha256 = NEW.source_turn_sha256
         AND attempt.trigger_reason = NEW.trigger_reason
         AND attempt.summary_instruction_version = NEW.summary_instruction_version
         AND attempt.target_config_digest_version = NEW.target_config_digest_version
         AND attempt.target_config_digest = NEW.target_config_digest
         AND attempt.target_model_id = NEW.target_model_id
         AND attempt.target_protocol = NEW.target_protocol
         AND attempt.target_context_window_tokens = NEW.target_context_window_tokens
         AND attempt.target_max_output_tokens IS NOT DISTINCT FROM NEW.target_max_output_tokens
         AND attempt.target_reasoning_effort IS NOT DISTINCT FROM NEW.target_reasoning_effort
         AND attempt.generation_variant_id = NEW.generation_variant_id
         AND attempt.generation_variant_revision = NEW.generation_variant_revision
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_COMPACTION_ATTEMPT_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_COMPACTION_IMMUTABLE';
  END IF;

  IF OLD.delete_after <= clock_timestamp()
    OR public.chat_history_privacy_purge_allowed(OLD.conversation_id)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_HISTORY_COMPACTION_RETAINED';
END;
$$;

CREATE TRIGGER conversation_history_compactions_mutation_guard
BEFORE INSERT OR UPDATE OR DELETE ON conversation_history_compactions
FOR EACH ROW EXECUTE FUNCTION chat_history_guard_compaction_mutation();

CREATE FUNCTION cleanup_expired_chat_history_compactions()
RETURNS TABLE(cutoff timestamptz, deleted_compactions bigint, deleted_attempts bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  cleanup_cutoff timestamptz := clock_timestamp();
  compaction_count bigint;
  attempt_count bigint;
BEGIN
  DELETE FROM public.conversation_history_compactions
   WHERE delete_after <= cleanup_cutoff;
  GET DIAGNOSTICS compaction_count = ROW_COUNT;

  DELETE FROM public.chat_history_summary_attempts AS attempt
   WHERE attempt.delete_after <= cleanup_cutoff
     AND NOT EXISTS (
       SELECT 1
         FROM public.conversation_history_compactions AS artifact
        WHERE artifact.summary_attempt_id = attempt.id
     );
  GET DIAGNOSTICS attempt_count = ROW_COUNT;

  RETURN QUERY SELECT cleanup_cutoff, compaction_count, attempt_count;
END;
$$;

CREATE FUNCTION purge_chat_session_for_privacy(target_session_id uuid)
RETURNS TABLE(deleted_access_sessions bigint, deleted_interaction_turns bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  session_count bigint;
  turn_count bigint;
BEGIN
  IF target_session_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.access_sessions WHERE id = target_session_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CHAT_PRIVACY_SESSION_INVALID';
  END IF;

  PERFORM set_config('morse.privacy_purge_session_id', target_session_id::text, true);
  DELETE FROM public.access_sessions WHERE id = target_session_id;
  GET DIAGNOSTICS session_count = ROW_COUNT;

  DELETE FROM public.interaction_turns WHERE access_session_id = target_session_id;
  GET DIAGNOSTICS turn_count = ROW_COUNT;

  PERFORM set_config('morse.privacy_purge_session_id', '', true);
  RETURN QUERY SELECT session_count, turn_count;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('morse.privacy_purge_session_id', '', true);
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION chat_history_privacy_purge_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION cleanup_expired_chat_history_compactions() FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_chat_session_for_privacy(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'runtime') THEN
    REVOKE ALL ON FUNCTION public.purge_chat_session_for_privacy(uuid) FROM runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker') THEN
    REVOKE ALL ON FUNCTION public.purge_chat_session_for_privacy(uuid) FROM worker;
    GRANT EXECUTE ON FUNCTION public.cleanup_expired_chat_history_compactions() TO worker;
  END IF;
END;
$$;
