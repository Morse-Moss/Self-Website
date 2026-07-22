ALTER TABLE interaction_turns
  ADD COLUMN invite_label text;

UPDATE interaction_turns AS turn
   SET invite_label = invite.label
  FROM access_sessions AS session
  JOIN invite_codes AS invite ON invite.id = session.invite_code_id
 WHERE session.id = turn.access_session_id
   AND turn.invite_label IS NULL;
