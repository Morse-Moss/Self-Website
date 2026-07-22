CREATE TABLE ai_connections (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  previous_version_id uuid REFERENCES ai_connections(id) ON DELETE RESTRICT,
  display_name varchar(120) NOT NULL
    CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120),
  base_url varchar(2048) NOT NULL
    CHECK (base_url = btrim(base_url) AND char_length(base_url) BETWEEN 9 AND 2048),
  user_agent varchar(512)
    CHECK (user_agent IS NULL OR (user_agent = btrim(user_agent) AND char_length(user_agent) BETWEEN 1 AND 512)),
  api_key_ciphertext bytea,
  api_key_iv bytea,
  api_key_tag bytea,
  key_version integer NOT NULL CHECK (key_version > 0),
  config_digest char(64) NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  secret_destroyed_at timestamptz,
  UNIQUE (series_id, version),
  CHECK (
    (api_key_ciphertext IS NOT NULL AND octet_length(api_key_ciphertext) > 0
      AND octet_length(api_key_iv) = 12 AND octet_length(api_key_tag) = 16
      AND secret_destroyed_at IS NULL)
    OR
    (api_key_ciphertext IS NULL AND api_key_iv IS NULL AND api_key_tag IS NULL
      AND secret_destroyed_at IS NOT NULL)
  ),
  CHECK (archived_at IS NULL OR archived_at >= created_at),
  CHECK (deleted_at IS NULL OR (archived_at IS NOT NULL AND deleted_at >= archived_at))
);

CREATE INDEX ai_connections_series_current_idx
  ON ai_connections(series_id, version DESC);
CREATE INDEX ai_connections_active_idx
  ON ai_connections(series_id, version DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL AND secret_destroyed_at IS NULL;

CREATE TABLE ai_model_presets (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  previous_version_id uuid REFERENCES ai_model_presets(id) ON DELETE RESTRICT,
  connection_version_id uuid NOT NULL REFERENCES ai_connections(id) ON DELETE RESTRICT,
  display_name varchar(120) NOT NULL
    CHECK (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 120),
  model_id varchar(512) NOT NULL
    CHECK (model_id = btrim(model_id) AND char_length(model_id) BETWEEN 1 AND 512),
  protocol varchar(32) NOT NULL CHECK (protocol IN ('responses', 'chat_completions')),
  reasoning_effort varchar(32)
    CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 1048576),
  input_usd_per_million numeric(14, 6) CHECK (input_usd_per_million >= 0),
  output_usd_per_million numeric(14, 6) CHECK (output_usd_per_million >= 0),
  config_digest char(64) NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (series_id, version),
  CHECK (archived_at IS NULL OR archived_at >= created_at),
  CHECK (deleted_at IS NULL OR (archived_at IS NOT NULL AND deleted_at >= archived_at))
);

CREATE INDEX ai_model_presets_series_current_idx
  ON ai_model_presets(series_id, version DESC);
CREATE INDEX ai_model_presets_connection_idx
  ON ai_model_presets(connection_version_id, series_id, version DESC);
CREATE INDEX ai_model_presets_active_idx
  ON ai_model_presets(series_id, version DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;

CREATE FUNCTION ai_guard_connection_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.series_id, NEW.version, NEW.previous_version_id, NEW.display_name,
    NEW.base_url, NEW.user_agent, NEW.key_version, NEW.config_digest, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.series_id, OLD.version, OLD.previous_version_id, OLD.display_name,
    OLD.base_url, OLD.user_agent, OLD.key_version, OLD.config_digest, OLD.created_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_CONNECTION_VERSION_IMMUTABLE';
  END IF;

  IF NOT (
    (NEW.archived_at IS NOT DISTINCT FROM OLD.archived_at)
    OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
  ) OR NOT (
    (NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at)
    OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_CONNECTION_LIFECYCLE_INVALID';
  END IF;

  IF ROW(NEW.api_key_ciphertext, NEW.api_key_iv, NEW.api_key_tag, NEW.secret_destroyed_at)
    IS DISTINCT FROM ROW(OLD.api_key_ciphertext, OLD.api_key_iv, OLD.api_key_tag, OLD.secret_destroyed_at)
    AND NOT (
      OLD.api_key_ciphertext IS NOT NULL
      AND OLD.api_key_iv IS NOT NULL
      AND OLD.api_key_tag IS NOT NULL
      AND OLD.secret_destroyed_at IS NULL
      AND NEW.api_key_ciphertext IS NULL
      AND NEW.api_key_iv IS NULL
      AND NEW.api_key_tag IS NULL
      AND NEW.secret_destroyed_at IS NOT NULL
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_CONNECTION_SECRET_MUTATION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_connections_immutable_update
BEFORE UPDATE ON ai_connections
FOR EACH ROW EXECUTE FUNCTION ai_guard_connection_update();

CREATE FUNCTION ai_guard_model_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.series_id, NEW.version, NEW.previous_version_id, NEW.connection_version_id,
    NEW.display_name, NEW.model_id, NEW.protocol, NEW.reasoning_effort,
    NEW.max_output_tokens, NEW.input_usd_per_million, NEW.output_usd_per_million,
    NEW.config_digest, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.series_id, OLD.version, OLD.previous_version_id, OLD.connection_version_id,
    OLD.display_name, OLD.model_id, OLD.protocol, OLD.reasoning_effort,
    OLD.max_output_tokens, OLD.input_usd_per_million, OLD.output_usd_per_million,
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

CREATE TRIGGER ai_model_presets_immutable_update
BEFORE UPDATE ON ai_model_presets
FOR EACH ROW EXECUTE FUNCTION ai_guard_model_update();

CREATE TABLE ai_route_revisions (
  id uuid PRIMARY KEY,
  revision_number bigint NOT NULL UNIQUE CHECK (revision_number > 0),
  previous_active_revision_id uuid REFERENCES ai_route_revisions(id) ON DELETE RESTRICT,
  activation_kind varchar(32) NOT NULL CHECK (activation_kind IN ('activate', 'rollback', 'bootstrap')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL,
  actor_admin_session_id uuid,
  CHECK (activated_at >= created_at)
);

CREATE TABLE ai_route_targets (
  route_revision_id uuid NOT NULL REFERENCES ai_route_revisions(id) ON DELETE CASCADE,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  source_type varchar(16) NOT NULL CHECK (source_type IN ('database', 'environment')),
  database_model_version_id uuid REFERENCES ai_model_presets(id) ON DELETE RESTRICT,
  environment_target_key varchar(32)
    CHECK (environment_target_key IS NULL OR environment_target_key IN ('primary', 'fallback-1', 'fallback-2')),
  connection_display_name varchar(120) NOT NULL
    CHECK (char_length(connection_display_name) BETWEEN 1 AND 120),
  model_display_name varchar(120) NOT NULL
    CHECK (char_length(model_display_name) BETWEEN 1 AND 120),
  model_id varchar(512) NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 512),
  protocol varchar(32) NOT NULL CHECK (protocol IN ('responses', 'chat_completions')),
  config_digest char(64) NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  input_usd_per_million numeric(14, 6) CHECK (input_usd_per_million >= 0),
  output_usd_per_million numeric(14, 6) CHECK (output_usd_per_million >= 0),
  PRIMARY KEY (route_revision_id, position),
  UNIQUE (route_revision_id, config_digest),
  CHECK (
    (source_type = 'database' AND database_model_version_id IS NOT NULL AND environment_target_key IS NULL)
    OR
    (source_type = 'environment' AND database_model_version_id IS NULL AND environment_target_key IS NOT NULL)
  )
);

CREATE INDEX ai_route_targets_model_history_idx
  ON ai_route_targets(database_model_version_id)
  WHERE database_model_version_id IS NOT NULL;

CREATE FUNCTION ai_prevent_route_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_ROUTE_REVISION_IMMUTABLE';
END;
$$;

CREATE TRIGGER ai_route_revisions_immutable_update
BEFORE UPDATE ON ai_route_revisions
FOR EACH ROW EXECUTE FUNCTION ai_prevent_route_update();

CREATE TRIGGER ai_route_targets_immutable_update
BEFORE UPDATE ON ai_route_targets
FOR EACH ROW EXECUTE FUNCTION ai_prevent_route_update();

CREATE FUNCTION ai_validate_route_revision() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  route_id uuid;
  target_count integer;
  ordered_positions smallint[];
BEGIN
  IF TG_TABLE_NAME = 'ai_route_revisions' THEN
    route_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    route_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.route_revision_id ELSE NEW.route_revision_id END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_route_revisions WHERE id = route_id) THEN
    RETURN NULL;
  END IF;

  SELECT count(*)::integer, array_agg(position ORDER BY position)
    INTO target_count, ordered_positions
    FROM public.ai_route_targets
   WHERE route_revision_id = route_id;

  IF target_count < 1 OR target_count > 6
    OR ordered_positions <> ARRAY(SELECT generate_series(0, target_count - 1)::smallint)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_ROUTE_TARGETS_INVALID';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ai_route_revision_complete_on_revision
AFTER INSERT OR UPDATE ON ai_route_revisions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_validate_route_revision();

CREATE CONSTRAINT TRIGGER ai_route_revision_complete_on_target
AFTER INSERT OR UPDATE OR DELETE ON ai_route_targets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ai_validate_route_revision();

CREATE TABLE ai_runtime_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  active_route_revision_id uuid REFERENCES ai_route_revisions(id) ON DELETE RESTRICT,
  lock_version bigint NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_runtime_state (id, active_route_revision_id, lock_version)
VALUES (true, NULL, 0);

CREATE INDEX ai_runtime_state_active_route_idx
  ON ai_runtime_state(active_route_revision_id)
  WHERE active_route_revision_id IS NOT NULL;

CREATE TABLE ai_config_events (
  id bigserial PRIMARY KEY,
  event_type varchar(64) NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 64),
  actor_admin_session_id uuid,
  connection_series_id uuid,
  connection_version integer CHECK (connection_version > 0),
  model_series_id uuid,
  model_version integer CHECK (model_version > 0),
  route_revision_id uuid,
  environment_target_key varchar(32)
    CHECK (environment_target_key IS NULL OR environment_target_key IN ('primary', 'fallback-1', 'fallback-2')),
  config_digest char(64) CHECK (config_digest IS NULL OR config_digest ~ '^[0-9a-f]{64}$'),
  result_code varchar(80) NOT NULL CHECK (char_length(result_code) BETWEEN 1 AND 80),
  status varchar(16) NOT NULL CHECK (status IN ('succeeded', 'failed', 'denied')),
  latency_ms integer CHECK (latency_ms >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  item_count integer CHECK (item_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '180 days'),
  CHECK (delete_after = created_at + interval '180 days')
);

CREATE INDEX ai_config_events_recent_idx ON ai_config_events(created_at DESC);
CREATE INDEX ai_config_events_retention_idx ON ai_config_events(delete_after);
CREATE INDEX ai_config_events_entity_idx
  ON ai_config_events(connection_series_id, model_series_id, created_at DESC);

CREATE FUNCTION ai_guard_config_event_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.delete_after > now() THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AI_CONFIG_EVENT_IMMUTABLE';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER ai_config_events_retention_guard
BEFORE UPDATE OR DELETE ON ai_config_events
FOR EACH ROW EXECUTE FUNCTION ai_guard_config_event_mutation();

CREATE TABLE interaction_provider_attempts (
  interaction_turn_id uuid NOT NULL REFERENCES interaction_turns(id) ON DELETE CASCADE,
  attempt_index smallint NOT NULL CHECK (attempt_index BETWEEN 0 AND 5),
  route_revision_id uuid REFERENCES ai_route_revisions(id) ON DELETE RESTRICT,
  target_position smallint CHECK (target_position BETWEEN 0 AND 5),
  source_type varchar(16) NOT NULL CHECK (source_type IN ('database', 'environment')),
  connection_version_id uuid REFERENCES ai_connections(id) ON DELETE RESTRICT,
  model_version_id uuid REFERENCES ai_model_presets(id) ON DELETE RESTRICT,
  connection_display_name varchar(120) NOT NULL CHECK (char_length(connection_display_name) BETWEEN 1 AND 120),
  model_display_name varchar(120) NOT NULL CHECK (char_length(model_display_name) BETWEEN 1 AND 120),
  model_id varchar(512) NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 512),
  protocol varchar(32) NOT NULL CHECK (protocol IN ('responses', 'chat_completions')),
  config_digest char(64) NOT NULL CHECK (config_digest ~ '^[0-9a-f]{64}$'),
  status varchar(24) NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'stopped')),
  error_code varchar(80) CHECK (error_code IS NULL OR char_length(error_code) BETWEEN 1 AND 80),
  first_byte_latency_ms integer CHECK (first_byte_latency_ms >= 0),
  total_latency_ms integer CHECK (total_latency_ms >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  usage_complete boolean NOT NULL DEFAULT false,
  known_cost_usd numeric(14, 6) CHECK (known_cost_usd >= 0),
  cost_complete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '10 days'),
  PRIMARY KEY (interaction_turn_id, attempt_index),
  CHECK (
    (source_type = 'database' AND connection_version_id IS NOT NULL AND model_version_id IS NOT NULL)
    OR
    (source_type = 'environment' AND connection_version_id IS NULL AND model_version_id IS NULL)
  ),
  CHECK (
    (status = 'started' AND completed_at IS NULL)
    OR
    (status IN ('completed', 'failed', 'stopped') AND completed_at IS NOT NULL)
  ),
  CHECK (
    (usage_complete = true AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
    OR
    (usage_complete = false AND input_tokens IS NULL AND output_tokens IS NULL)
  ),
  CHECK (
    (cost_complete = true AND known_cost_usd IS NOT NULL)
    OR
    (cost_complete = false AND known_cost_usd IS NULL)
  ),
  CHECK (delete_after = created_at + interval '10 days'),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX interaction_provider_attempts_retention_idx
  ON interaction_provider_attempts(delete_after);
CREATE INDEX interaction_provider_attempts_route_idx
  ON interaction_provider_attempts(route_revision_id, target_position);
CREATE INDEX interaction_provider_attempts_model_history_idx
  ON interaction_provider_attempts(model_version_id)
  WHERE model_version_id IS NOT NULL;

ALTER TABLE interaction_turns
  ADD COLUMN route_revision_id uuid REFERENCES ai_route_revisions(id) ON DELETE RESTRICT,
  ADD COLUMN target_position smallint CHECK (target_position BETWEEN 0 AND 5),
  ADD COLUMN provider_protocol varchar(32)
    CHECK (provider_protocol IS NULL OR provider_protocol IN ('responses', 'chat_completions')),
  ADD COLUMN provider_config_digest char(64)
    CHECK (provider_config_digest IS NULL OR provider_config_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN known_cost_usd numeric(14, 6) CHECK (known_cost_usd >= 0),
  ADD COLUMN usage_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN cost_complete boolean NOT NULL DEFAULT false;

CREATE INDEX interaction_turns_route_history_idx
  ON interaction_turns(route_revision_id, target_position)
  WHERE route_revision_id IS NOT NULL;

ALTER TABLE usage_events
  ALTER COLUMN estimated_cost_usd DROP NOT NULL,
  ALTER COLUMN estimated_cost_usd DROP DEFAULT,
  ADD COLUMN interaction_turn_id uuid REFERENCES interaction_turns(id) ON DELETE SET NULL,
  ADD COLUMN provider_attempt_index smallint CHECK (provider_attempt_index BETWEEN 0 AND 5),
  ADD COLUMN cost_complete boolean,
  ADD CONSTRAINT usage_events_attempt_pair_check CHECK (
    (interaction_turn_id IS NULL AND provider_attempt_index IS NULL)
    OR
    (interaction_turn_id IS NOT NULL AND provider_attempt_index IS NOT NULL)
  ),
  ADD CONSTRAINT usage_events_cost_complete_check CHECK (
    cost_complete IS NULL
    OR (cost_complete = true AND estimated_cost_usd IS NOT NULL)
    OR (cost_complete = false AND estimated_cost_usd IS NULL)
  ),
  ADD CONSTRAINT usage_events_provider_attempt_fk
    FOREIGN KEY (interaction_turn_id, provider_attempt_index)
    REFERENCES interaction_provider_attempts(interaction_turn_id, attempt_index)
    ON DELETE SET NULL;

CREATE INDEX usage_events_attempt_idx
  ON usage_events(interaction_turn_id, provider_attempt_index)
  WHERE interaction_turn_id IS NOT NULL;
