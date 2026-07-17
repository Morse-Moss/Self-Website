ALTER TABLE conversations
  ADD COLUMN workflow text NOT NULL DEFAULT 'chat'
    CHECK (workflow IN ('chat', 'jd_match', 'diagnosis'));

ALTER TABLE conversations
  ADD COLUMN audience_intent text NOT NULL DEFAULT 'general';

ALTER TABLE access_sessions
  ADD COLUMN search_count integer NOT NULL DEFAULT 0
    CHECK (search_count >= 0);

CREATE TABLE interaction_turns (
  id uuid PRIMARY KEY,
  access_session_id uuid NOT NULL,
  conversation_id uuid,
  workflow text NOT NULL CHECK (workflow IN ('chat', 'jd_match', 'diagnosis')),
  audience_intent text NOT NULL,
  question text NOT NULL,
  answer text,
  status text NOT NULL,
  error_code text,
  knowledge_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd >= 0),
  provider text,
  model text,
  latency_ms integer CHECK (latency_ms >= 0),
  used_search boolean NOT NULL DEFAULT false,
  badcase boolean NOT NULL DEFAULT false,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  delete_after timestamptz NOT NULL,
  CHECK (delete_after > created_at)
);

CREATE INDEX interaction_turns_created_at_idx
  ON interaction_turns(created_at DESC);
CREATE INDEX interaction_turns_delete_after_idx
  ON interaction_turns(delete_after);
CREATE INDEX interaction_turns_filter_idx
  ON interaction_turns(workflow, status, created_at DESC);
CREATE INDEX interaction_turns_badcase_idx
  ON interaction_turns(badcase, created_at DESC) WHERE badcase = true;

CREATE TABLE interaction_searches (
  id uuid PRIMARY KEY,
  interaction_turn_id uuid NOT NULL UNIQUE
    REFERENCES interaction_turns(id) ON DELETE CASCADE,
  query text NOT NULL,
  route_reason text NOT NULL,
  status text NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL,
  CHECK (delete_after > created_at)
);

CREATE INDEX interaction_searches_delete_after_idx
  ON interaction_searches(delete_after);

CREATE TABLE diagnoses (
  id uuid PRIMARY KEY,
  interaction_turn_id uuid NOT NULL UNIQUE
    REFERENCES interaction_turns(id) ON DELETE CASCADE,
  access_session_id uuid NOT NULL,
  conversation_id uuid,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  status text NOT NULL,
  notification_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  delete_after timestamptz NOT NULL,
  CHECK (delete_after > created_at)
);

CREATE INDEX diagnoses_status_idx
  ON diagnoses(status, created_at DESC);
CREATE INDEX diagnoses_delete_after_idx
  ON diagnoses(delete_after);

CREATE TABLE alert_outbox (
  id bigserial PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  category text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_outbox_dispatch_idx
  ON alert_outbox(status, available_at, id);
CREATE INDEX alert_outbox_expires_at_idx
  ON alert_outbox(expires_at);

CREATE TABLE service_incidents (
  id uuid PRIMARY KEY,
  dependency text NOT NULL,
  fingerprint char(64) NOT NULL,
  status text NOT NULL DEFAULT 'observing',
  failure_count integer NOT NULL DEFAULT 1 CHECK (failure_count > 0),
  window_started_at timestamptz NOT NULL,
  last_failure_at timestamptz NOT NULL,
  down_at timestamptz,
  recovered_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX service_incidents_active_idx
  ON service_incidents(dependency, fingerprint)
  WHERE status IN ('observing', 'down');
CREATE INDEX service_incidents_updated_at_idx
  ON service_incidents(updated_at DESC);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX admin_sessions_expires_at_idx
  ON admin_sessions(expires_at);

CREATE TABLE admin_security_state (
  id text PRIMARY KEY,
  last_totp_counter bigint,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE access_attempts (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  fingerprint_hash char(64) NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX access_attempts_window_idx
  ON access_attempts(scope, fingerprint_hash, attempted_at DESC);
CREATE INDEX access_attempts_expires_at_idx
  ON access_attempts(expires_at);
