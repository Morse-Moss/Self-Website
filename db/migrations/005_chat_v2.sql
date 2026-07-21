ALTER TABLE access_sessions
  ADD COLUMN chat_behavior_version text
  CHECK (chat_behavior_version IN ('v1', 'v2'));

CREATE TABLE chat_provider_attempts (
  interaction_turn_id uuid NOT NULL
    REFERENCES interaction_turns(id) ON DELETE CASCADE,
  execution_id uuid NOT NULL,
  attempt_no smallint NOT NULL CHECK (attempt_no > 0),
  provider_alias text NOT NULL
    CHECK (
      char_length(provider_alias) BETWEEN 1 AND 32
      AND provider_alias ~ '^[a-z0-9][a-z0-9_-]*$'
    ),
  launch_kind text NOT NULL
    CHECK (launch_kind IN ('primary', 'hedge', 'failover')),
  status text NOT NULL
    CHECK (status IN ('started', 'streaming', 'completed', 'failed', 'aborted')),
  winner boolean NOT NULL DEFAULT false,
  start_delay_ms integer NOT NULL CHECK (start_delay_ms >= 0),
  first_byte_ms integer CHECK (first_byte_ms >= 0),
  duration_ms integer CHECK (duration_ms >= 0),
  error_code text
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  delete_after timestamptz NOT NULL,
  PRIMARY KEY (interaction_turn_id, execution_id, attempt_no),
  CHECK (delete_after > started_at)
);

CREATE INDEX chat_provider_attempts_delete_after_idx
  ON chat_provider_attempts(delete_after);
CREATE INDEX chat_provider_attempts_alias_started_idx
  ON chat_provider_attempts(provider_alias, started_at DESC);
