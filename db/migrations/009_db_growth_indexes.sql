CREATE INDEX interaction_turns_inherited_from_idx
  ON interaction_turns(inherited_from_turn_id)
  WHERE inherited_from_turn_id IS NOT NULL;

CREATE INDEX interaction_turns_running_session_idx
  ON interaction_turns(access_session_id)
  WHERE status = 'running';

CREATE INDEX interaction_turns_conversation_created_idx
  ON interaction_turns(conversation_id, created_at DESC);

CREATE INDEX interaction_turns_completed_at_idx
  ON interaction_turns(completed_at)
  WHERE status = 'completed';

CREATE INDEX conversations_session_updated_idx
  ON conversations(access_session_id, updated_at DESC);

CREATE INDEX usage_events_interaction_turn_idx
  ON usage_events(interaction_turn_id);

CREATE INDEX usage_events_access_session_idx
  ON usage_events(access_session_id);

CREATE INDEX usage_events_conversation_idx
  ON usage_events(conversation_id);

CREATE INDEX chat_provider_attempts_hedge_started_idx
  ON chat_provider_attempts(launch_kind, started_at)
  WHERE launch_kind = 'hedge';
