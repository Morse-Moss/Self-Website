DO $$
DECLARE
  missing_privileges text[];
  forbidden_privileges text[];
BEGIN
  WITH required(table_name, privilege) AS (VALUES
    ('ai_connections', 'SELECT'),
    ('ai_connections', 'INSERT'),
    ('ai_connections', 'UPDATE'),
    ('ai_connections', 'DELETE'),
    ('ai_model_presets', 'SELECT'),
    ('ai_model_presets', 'INSERT'),
    ('ai_model_presets', 'UPDATE'),
    ('ai_model_presets', 'DELETE'),
    ('ai_route_revisions', 'SELECT'),
    ('ai_route_revisions', 'INSERT'),
    ('ai_route_targets', 'SELECT'),
    ('ai_route_targets', 'INSERT'),
    ('ai_runtime_state', 'SELECT'),
    ('ai_runtime_state', 'UPDATE'),
    ('ai_config_events', 'SELECT'),
    ('ai_config_events', 'INSERT'),
    ('ai_config_events', 'DELETE'),
    ('interaction_provider_attempts', 'SELECT'),
    ('interaction_provider_attempts', 'INSERT'),
    ('interaction_provider_attempts', 'UPDATE'),
    ('interaction_provider_attempts', 'DELETE')
  )
  SELECT array_agg(format('%s:%s', table_name, privilege) ORDER BY table_name, privilege)
    INTO missing_privileges
    FROM required
   WHERE NOT has_table_privilege('runtime', format('public.%I', table_name), privilege);

  WITH forbidden(table_name, privilege) AS (VALUES
    ('ai_route_revisions', 'UPDATE'),
    ('ai_route_revisions', 'DELETE'),
    ('ai_route_targets', 'UPDATE'),
    ('ai_route_targets', 'DELETE'),
    ('ai_runtime_state', 'INSERT'),
    ('ai_runtime_state', 'DELETE'),
    ('ai_config_events', 'UPDATE')
  )
  SELECT array_agg(format('%s:%s', table_name, privilege) ORDER BY table_name, privilege)
    INTO forbidden_privileges
    FROM forbidden
   WHERE has_table_privilege('runtime', format('public.%I', table_name), privilege);

  IF missing_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role is missing AI configuration privileges: %', missing_privileges;
  END IF;
  IF forbidden_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'runtime role has forbidden AI configuration privileges: %', forbidden_privileges;
  END IF;

  IF NOT has_sequence_privilege('runtime', 'public.ai_config_events_id_seq', 'USAGE,SELECT')
    OR has_sequence_privilege('runtime', 'public.ai_config_events_id_seq', 'UPDATE')
  THEN
    RAISE EXCEPTION 'runtime role has invalid AI configuration sequence privileges';
  END IF;
END
$$;
