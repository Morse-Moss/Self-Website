DO $$
DECLARE
  missing_privileges text[];
  forbidden_privileges text[];
  schema_013 boolean;
  migration_is_super boolean;
  public_can_purge boolean;
BEGIN
  SELECT migration.rolsuper
    INTO migration_is_super
    FROM pg_roles AS migration
   WHERE migration.rolname = 'migration';
  IF migration_is_super IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'migration.rolsuper must be false after grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker') THEN
    RAISE EXCEPTION 'worker role is missing';
  END IF;

  WITH required(role_name, table_name, privilege) AS (VALUES
    ('runtime', 'ai_connections', 'SELECT'),
    ('runtime', 'ai_connections', 'INSERT'),
    ('runtime', 'ai_connections', 'UPDATE'),
    ('runtime', 'ai_connections', 'DELETE'),
    ('runtime', 'ai_model_presets', 'SELECT'),
    ('runtime', 'ai_model_presets', 'INSERT'),
    ('runtime', 'ai_model_presets', 'UPDATE'),
    ('runtime', 'ai_model_presets', 'DELETE'),
    ('runtime', 'ai_route_revisions', 'SELECT'),
    ('runtime', 'ai_route_revisions', 'INSERT'),
    ('runtime', 'ai_route_targets', 'SELECT'),
    ('runtime', 'ai_route_targets', 'INSERT'),
    ('runtime', 'ai_runtime_state', 'SELECT'),
    ('runtime', 'ai_runtime_state', 'UPDATE'),
    ('runtime', 'ai_config_events', 'SELECT'),
    ('runtime', 'ai_config_events', 'INSERT'),
    ('runtime', 'ai_config_events', 'DELETE'),
    ('runtime', 'ai_environment_takeovers', 'SELECT'),
    ('runtime', 'ai_environment_takeovers', 'INSERT'),
    ('runtime', 'ai_environment_takeovers', 'UPDATE'),
    ('runtime', 'interaction_provider_attempts', 'SELECT'),
    ('runtime', 'interaction_provider_attempts', 'INSERT'),
    ('runtime', 'interaction_provider_attempts', 'UPDATE'),
    ('runtime', 'interaction_provider_attempts', 'DELETE'),
    ('worker', 'interaction_searches', 'SELECT'),
    ('worker', 'interaction_searches', 'DELETE'),
    ('worker', 'diagnoses', 'SELECT'),
    ('worker', 'diagnoses', 'DELETE'),
    ('worker', 'interaction_turns', 'SELECT'),
    ('worker', 'interaction_turns', 'DELETE'),
    ('worker', 'access_sessions', 'SELECT'),
    ('worker', 'access_sessions', 'DELETE'),
    ('worker', 'admin_sessions', 'SELECT'),
    ('worker', 'admin_sessions', 'DELETE'),
    ('worker', 'access_attempts', 'SELECT'),
    ('worker', 'access_attempts', 'DELETE'),
    ('worker', 'ai_config_events', 'SELECT'),
    ('worker', 'ai_config_events', 'DELETE'),
    ('worker', 'usage_events', 'SELECT'),
    ('worker', 'usage_events', 'DELETE'),
    ('worker', 'service_incidents', 'SELECT'),
    ('worker', 'service_incidents', 'DELETE'),
    ('worker', 'resume_sessions', 'SELECT'),
    ('worker', 'resume_sessions', 'DELETE'),
    ('worker', 'invite_codes', 'SELECT'),
    ('worker', 'invite_codes', 'UPDATE'),
    ('worker', 'resume_invites', 'SELECT'),
    ('worker', 'resume_invites', 'UPDATE'),
    ('worker', 'alert_outbox', 'SELECT'),
    ('worker', 'alert_outbox', 'UPDATE'),
    ('worker', 'alert_outbox', 'DELETE'),
    ('worker', 'resume_access_events', 'SELECT'),
    ('worker', 'resume_access_events', 'INSERT'),
    ('worker', 'resume_access_events', 'DELETE'),
    ('worker', 'resume_documents', 'SELECT')
  )
  SELECT array_agg(format('%s:%s:%s', role_name, table_name, privilege)
                   ORDER BY role_name, table_name, privilege)
    INTO missing_privileges
    FROM required
   WHERE NOT has_table_privilege(role_name, format('public.%I', table_name), privilege);

  WITH forbidden(role_name, table_name, privilege) AS (VALUES
    ('runtime', 'ai_route_revisions', 'UPDATE'),
    ('runtime', 'ai_route_revisions', 'DELETE'),
    ('runtime', 'ai_route_targets', 'UPDATE'),
    ('runtime', 'ai_route_targets', 'DELETE'),
    ('runtime', 'ai_runtime_state', 'INSERT'),
    ('runtime', 'ai_runtime_state', 'DELETE'),
    ('runtime', 'ai_config_events', 'UPDATE'),
    ('runtime', 'ai_environment_takeovers', 'DELETE'),
    ('worker', 'ai_connections', 'SELECT'),
    ('worker', 'ai_model_presets', 'SELECT'),
    ('worker', 'ai_route_revisions', 'SELECT'),
    ('worker', 'ai_route_targets', 'SELECT'),
    ('worker', 'ai_runtime_state', 'SELECT'),
    ('worker', 'ai_environment_takeovers', 'SELECT'),
    ('worker', 'interaction_provider_attempts', 'SELECT'),
    ('worker', 'interaction_searches', 'INSERT'),
    ('worker', 'interaction_searches', 'UPDATE'),
    ('worker', 'diagnoses', 'INSERT'),
    ('worker', 'diagnoses', 'UPDATE'),
    ('worker', 'interaction_turns', 'INSERT'),
    ('worker', 'interaction_turns', 'UPDATE'),
    ('worker', 'access_sessions', 'INSERT'),
    ('worker', 'access_sessions', 'UPDATE'),
    ('worker', 'invite_codes', 'INSERT'),
    ('worker', 'invite_codes', 'DELETE'),
    ('worker', 'resume_invites', 'INSERT'),
    ('worker', 'resume_invites', 'DELETE'),
    ('worker', 'alert_outbox', 'INSERT'),
    ('worker', 'resume_access_events', 'UPDATE'),
    ('worker', 'resume_documents', 'INSERT'),
    ('worker', 'resume_documents', 'UPDATE'),
    ('worker', 'resume_documents', 'DELETE')
  )
  SELECT array_agg(format('%s:%s:%s', role_name, table_name, privilege)
                   ORDER BY role_name, table_name, privilege)
    INTO forbidden_privileges
    FROM forbidden
   WHERE has_table_privilege(role_name, format('public.%I', table_name), privilege);

  IF missing_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'roles are missing required privileges: %', missing_privileges;
  END IF;
  IF forbidden_privileges IS NOT NULL THEN
    RAISE EXCEPTION 'roles have forbidden privileges: %', forbidden_privileges;
  END IF;
  IF NOT has_sequence_privilege('runtime', 'public.ai_config_events_id_seq', 'USAGE')
    OR NOT has_sequence_privilege('runtime', 'public.ai_config_events_id_seq', 'SELECT')
    OR has_sequence_privilege('runtime', 'public.ai_config_events_id_seq', 'UPDATE')
  THEN
    RAISE EXCEPTION 'runtime role has invalid AI configuration sequence privileges';
  END IF;
  IF NOT has_sequence_privilege('worker', 'public.resume_access_events_id_seq', 'USAGE')
    OR NOT has_sequence_privilege('worker', 'public.resume_access_events_id_seq', 'SELECT')
    OR has_sequence_privilege('worker', 'public.resume_access_events_id_seq', 'UPDATE')
  THEN
    RAISE EXCEPTION 'worker role has invalid resume event sequence privileges';
  END IF;

  IF (to_regclass('public.conversation_history_compactions') IS NULL)
     <> (to_regclass('public.chat_history_summary_attempts') IS NULL)
  THEN
    RAISE EXCEPTION 'partial migration 013 private schema detected';
  END IF;
  schema_013 := to_regclass('public.conversation_history_compactions') IS NOT NULL;

  IF schema_013 THEN
    IF to_regprocedure('public.cleanup_expired_chat_history_compactions()') IS NULL
      OR to_regprocedure('public.purge_chat_session_for_privacy(uuid)') IS NULL
    THEN
      RAISE EXCEPTION 'migration 013 functions are missing';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_proc AS procedure
       WHERE procedure.oid IN (
         'public.cleanup_expired_chat_history_compactions()'::regprocedure,
         'public.purge_chat_session_for_privacy(uuid)'::regprocedure
       )
         AND pg_get_userbyid(procedure.proowner) <> 'migration'
    ) THEN
      RAISE EXCEPTION 'migration does not own the migration 013 security-definer functions';
    END IF;
    IF NOT has_table_privilege('runtime', 'public.conversation_history_compactions', 'SELECT')
      OR NOT has_table_privilege('runtime', 'public.conversation_history_compactions', 'INSERT')
      OR has_table_privilege('runtime', 'public.conversation_history_compactions', 'UPDATE')
      OR has_table_privilege('runtime', 'public.conversation_history_compactions', 'DELETE')
      OR NOT has_table_privilege('runtime', 'public.chat_history_summary_attempts', 'SELECT')
      OR NOT has_table_privilege('runtime', 'public.chat_history_summary_attempts', 'INSERT')
      OR NOT has_table_privilege('runtime', 'public.chat_history_summary_attempts', 'UPDATE')
      OR has_table_privilege('runtime', 'public.chat_history_summary_attempts', 'DELETE')
    THEN
      RAISE EXCEPTION 'runtime role has invalid migration 013 privileges';
    END IF;
    IF NOT has_column_privilege('worker', 'public.chat_history_summary_attempts', 'interaction_turn_id', 'SELECT')
      OR NOT has_column_privilege('worker', 'public.chat_history_summary_attempts', 'delete_after', 'SELECT')
      OR NOT has_column_privilege('worker', 'public.conversation_history_compactions', 'conversation_id', 'SELECT')
      OR NOT has_column_privilege('worker', 'public.conversation_history_compactions', 'delete_after', 'SELECT')
      OR has_column_privilege('worker', 'public.chat_history_summary_attempts', 'source_turn_ids', 'SELECT')
      OR has_column_privilege('worker', 'public.chat_history_summary_attempts', 'summary_request_hmac_sha256', 'SELECT')
      OR has_column_privilege('worker', 'public.conversation_history_compactions', 'summary_text', 'SELECT')
      OR has_column_privilege('worker', 'public.conversation_history_compactions', 'source_turn_sha256', 'SELECT')
      OR has_table_privilege('worker', 'public.chat_history_summary_attempts', 'INSERT')
      OR has_table_privilege('worker', 'public.chat_history_summary_attempts', 'UPDATE')
      OR has_table_privilege('worker', 'public.chat_history_summary_attempts', 'DELETE')
      OR has_table_privilege('worker', 'public.conversation_history_compactions', 'INSERT')
      OR has_table_privilege('worker', 'public.conversation_history_compactions', 'UPDATE')
      OR has_table_privilege('worker', 'public.conversation_history_compactions', 'DELETE')
      OR has_table_privilege('worker', 'public.conversations', 'SELECT')
      OR NOT has_column_privilege('worker', 'public.conversations', 'id', 'SELECT')
      OR NOT has_column_privilege('worker', 'public.conversations', 'access_session_id', 'SELECT')
      OR has_column_privilege('worker', 'public.conversations', 'mode', 'SELECT')
    THEN
      RAISE EXCEPTION 'worker role has invalid migration 013 table privileges';
    END IF;
    IF NOT has_function_privilege('worker', 'public.cleanup_expired_chat_history_compactions()', 'EXECUTE')
      OR has_function_privilege('worker', 'public.purge_chat_session_for_privacy(uuid)', 'EXECUTE')
      OR has_function_privilege('runtime', 'public.purge_chat_session_for_privacy(uuid)', 'EXECUTE')
    THEN
      RAISE EXCEPTION 'runtime or worker has invalid migration 013 function privileges';
    END IF;
    SELECT EXISTS (
      SELECT 1
        FROM pg_proc AS procedure
        CROSS JOIN LATERAL aclexplode(
          COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
        ) AS privilege
       WHERE procedure.oid = 'public.purge_chat_session_for_privacy(uuid)'::regprocedure
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
    ) INTO public_can_purge;
    IF public_can_purge THEN
      RAISE EXCEPTION 'PUBLIC can execute the privacy purge function';
    END IF;
  ELSE
    IF to_regprocedure('public.cleanup_expired_chat_history_compactions()') IS NOT NULL
      OR to_regprocedure('public.purge_chat_session_for_privacy(uuid)') IS NOT NULL
    THEN
      RAISE EXCEPTION 'schema 012 unexpectedly exposes migration 013 functions';
    END IF;
  END IF;
END
$$;
