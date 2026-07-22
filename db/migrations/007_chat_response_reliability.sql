ALTER TABLE interaction_turns
  ADD COLUMN route_kind text
    CHECK (
      route_kind IS NULL
      OR route_kind IN (
        'conversation', 'external_current', 'identity', 'personal_fact',
        'grounded', 'jd_intake', 'jd', 'clarify'
      )
    ),
  ADD COLUMN route_reason_code text
    CHECK (route_reason_code IS NULL OR route_reason_code ~ '^[a-z0-9_]{1,80}$'),
  ADD COLUMN topic_kind text
    CHECK (topic_kind IS NULL OR topic_kind IN ('none', 'external', 'project', 'capability', 'jd')),
  ADD COLUMN topic_ref text
    CHECK (topic_ref IS NULL OR char_length(topic_ref) BETWEEN 1 AND 160),
  ADD COLUMN evidence_class text
    CHECK (
      evidence_class IS NULL
      OR evidence_class IN ('none', 'identity', 'web', 'direct', 'transferable', 'mixed', 'unavailable')
    ),
  ADD COLUMN inherited_from_turn_id uuid
    REFERENCES interaction_turns(id) ON DELETE SET NULL;

ALTER TABLE interaction_provider_attempts
  ADD COLUMN launch_kind text
    CHECK (launch_kind IS NULL OR launch_kind IN ('primary', 'hedge', 'failover')),
  ADD COLUMN generation_mode text
    CHECK (generation_mode IS NULL OR generation_mode IN ('normal', 'strict')),
  ADD COLUMN first_protocol_event_ms integer CHECK (first_protocol_event_ms >= 0),
  ADD COLUMN first_model_text_ms integer CHECK (first_model_text_ms >= 0),
  ADD COLUMN first_user_visible_ms integer CHECK (first_user_visible_ms >= 0);

ALTER TABLE chat_provider_attempts
  ADD COLUMN generation_mode text
    CHECK (generation_mode IS NULL OR generation_mode IN ('normal', 'strict')),
  ADD COLUMN first_protocol_event_ms integer CHECK (first_protocol_event_ms >= 0),
  ADD COLUMN first_model_text_ms integer CHECK (first_model_text_ms >= 0),
  ADD COLUMN first_user_visible_ms integer CHECK (first_user_visible_ms >= 0);
