DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worker') THEN
    CREATE ROLE worker LOGIN;
  END IF;
END
$$;

ALTER ROLE worker PASSWORD :'worker_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT CONNECT ON DATABASE revolution TO runtime, worker, migration, ingest, backup;
GRANT USAGE ON SCHEMA public TO runtime, worker, ingest, backup;

ALTER DEFAULT PRIVILEGES FOR ROLE migration IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM runtime, worker;
ALTER DEFAULT PRIVILEGES FOR ROLE migration IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM runtime, worker;
ALTER DEFAULT PRIVILEGES FOR ROLE migration IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM runtime, worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO runtime;

REVOKE ALL PRIVILEGES ON TABLE
  ai_connections,
  ai_model_presets,
  ai_route_revisions,
  ai_route_targets,
  ai_runtime_state,
  ai_config_events,
  ai_environment_takeovers,
  interaction_provider_attempts
FROM runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE ai_connections, ai_model_presets
  TO runtime;
GRANT SELECT, INSERT
  ON TABLE ai_route_revisions, ai_route_targets
  TO runtime;
GRANT SELECT, UPDATE
  ON TABLE ai_runtime_state
  TO runtime;
GRANT SELECT, INSERT, DELETE
  ON TABLE ai_config_events
  TO runtime;
GRANT SELECT, INSERT, UPDATE
  ON TABLE ai_environment_takeovers
  TO runtime;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE interaction_provider_attempts
  TO runtime;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM worker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM worker;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM worker;

GRANT SELECT, DELETE ON TABLE
  interaction_searches,
  diagnoses,
  interaction_turns,
  access_sessions,
  admin_sessions,
  access_attempts,
  ai_config_events,
  usage_events,
  service_incidents,
  resume_sessions
TO worker;
GRANT SELECT, UPDATE ON TABLE invite_codes, resume_invites TO worker;
GRANT SELECT, UPDATE, DELETE ON TABLE alert_outbox TO worker;
GRANT SELECT, INSERT, DELETE ON TABLE resume_access_events TO worker;
GRANT SELECT ON TABLE resume_documents TO worker;
GRANT SELECT (id, access_session_id) ON TABLE conversations TO worker;
GRANT USAGE, SELECT ON SEQUENCE resume_access_events_id_seq TO worker;

DO $$
BEGIN
  IF to_regclass('public.conversation_history_compactions') IS NOT NULL
     AND to_regclass('public.chat_history_summary_attempts') IS NOT NULL
  THEN
    EXECUTE 'ALTER FUNCTION public.cleanup_expired_chat_history_compactions() OWNER TO migration';
    EXECUTE 'ALTER FUNCTION public.purge_chat_session_for_privacy(uuid) OWNER TO migration';
    EXECUTE 'REVOKE ALL ON public.conversation_history_compactions, public.chat_history_summary_attempts FROM runtime, worker';
    EXECUTE 'REVOKE ALL ON FUNCTION public.purge_chat_session_for_privacy(uuid) FROM PUBLIC, runtime, worker';
    EXECUTE 'GRANT SELECT, INSERT ON public.conversation_history_compactions TO runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.chat_history_summary_attempts TO runtime';
    EXECUTE 'GRANT SELECT (interaction_turn_id, delete_after) ON public.chat_history_summary_attempts TO worker';
    EXECUTE 'GRANT SELECT (conversation_id, delete_after) ON public.conversation_history_compactions TO worker';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.cleanup_expired_chat_history_compactions() TO worker';
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE knowledge_documents, knowledge_chunks
  TO ingest;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup;

ALTER ROLE migration NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
