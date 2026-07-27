CREATE TABLE ai_environment_takeovers (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  environment_target_key varchar(32) NOT NULL
    CHECK (environment_target_key IN ('primary', 'fallback-1', 'fallback-2')),
  source_config_digest char(64) NOT NULL
    CHECK (source_config_digest ~ '^[0-9a-f]{64}$'),
  initial_connection_version_id uuid NOT NULL
    REFERENCES ai_connections(id) ON DELETE RESTRICT,
  initial_model_version_id uuid NOT NULL
    REFERENCES ai_model_presets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK (released_at IS NULL OR released_at >= created_at)
);

CREATE UNIQUE INDEX ai_environment_takeovers_active_target_idx
  ON ai_environment_takeovers(environment_target_key)
  WHERE released_at IS NULL;

CREATE INDEX ai_environment_takeovers_connection_idx
  ON ai_environment_takeovers(initial_connection_version_id);

CREATE INDEX ai_environment_takeovers_model_idx
  ON ai_environment_takeovers(initial_model_version_id);

CREATE FUNCTION ai_guard_environment_takeover_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF ROW(
    NEW.id,
    NEW.request_id,
    NEW.environment_target_key,
    NEW.source_config_digest,
    NEW.initial_connection_version_id,
    NEW.initial_model_version_id,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.request_id,
    OLD.environment_target_key,
    OLD.source_config_digest,
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

CREATE TRIGGER ai_environment_takeovers_immutable_update
BEFORE UPDATE ON ai_environment_takeovers
FOR EACH ROW EXECUTE FUNCTION ai_guard_environment_takeover_update();
