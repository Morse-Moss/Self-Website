GRANT CONNECT ON DATABASE revolution TO runtime, migration, ingest, backup;
GRANT USAGE ON SCHEMA public TO runtime, ingest, backup;

ALTER DEFAULT PRIVILEGES FOR ROLE migration IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE migration IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO runtime;

REVOKE ALL PRIVILEGES ON TABLE
  ai_connections,
  ai_model_presets,
  ai_route_revisions,
  ai_route_targets,
  ai_runtime_state,
  ai_config_events,
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
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE interaction_provider_attempts
  TO runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE knowledge_documents, knowledge_chunks
  TO ingest;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO backup;

ALTER ROLE migration NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
