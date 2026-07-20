CREATE TABLE resume_documents (
  id uuid PRIMARY KEY,
  storage_name text NOT NULL UNIQUE
    CHECK (storage_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]morsepdf$'),
  cipher_sha256 char(64) NOT NULL
    CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),
  plaintext_bytes bigint NOT NULL CHECK (plaintext_bytes > 0),
  ciphertext_bytes bigint NOT NULL CHECK (ciphertext_bytes > plaintext_bytes),
  envelope_version integer NOT NULL DEFAULT 1 CHECK (envelope_version = 1),
  key_version integer NOT NULL CHECK (key_version > 0),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by_admin_session uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX resume_documents_one_current_idx
  ON resume_documents(is_current) WHERE is_current = true;

CREATE TABLE resume_invites (
  id uuid PRIMARY KEY,
  code_hash char(64) NOT NULL UNIQUE
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  trusted_person_note varchar(200) NOT NULL
    CHECK (
      trusted_person_note = btrim(trusted_person_note)
      AND char_length(trusted_person_note) BETWEEN 1 AND 200
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz,
  disabled_at timestamptz,
  created_by_admin_session uuid NOT NULL,
  disabled_by_admin_session uuid,
  CHECK (expires_at > created_at),
  CHECK (
    redeemed_at IS NULL
    OR (redeemed_at >= created_at AND redeemed_at <= expires_at)
  ),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at)
);

CREATE INDEX resume_invites_state_idx
  ON resume_invites(disabled_at, redeemed_at, expires_at DESC);

CREATE TABLE resume_sessions (
  id uuid PRIMARY KEY,
  invite_id uuid NOT NULL UNIQUE
    REFERENCES resume_invites(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  source_ip inet NOT NULL,
  user_agent text NOT NULL CHECK (char_length(user_agent) <= 1024),
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (last_seen_at >= created_at),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX resume_sessions_expiry_idx
  ON resume_sessions(expires_at);

CREATE TABLE resume_access_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'invite_created',
    'redeem_succeeded',
    'redeem_failed',
    'file_returned',
    'session_logged_out',
    'invite_disabled',
    'expired_cleanup',
    'document_uploaded',
    'document_replaced',
    'key_rotation_prepared',
    'key_rotation_activated',
    'key_rotation_finalized',
    'key_rotation_rolled_back',
    'storage_recovery'
  )),
  result_code varchar(80) NOT NULL
    CHECK (char_length(result_code) BETWEEN 1 AND 80),
  invite_id uuid REFERENCES resume_invites(id) ON DELETE SET NULL,
  session_id uuid REFERENCES resume_sessions(id) ON DELETE SET NULL,
  source_ip inet,
  user_agent varchar(1024),
  device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL,
  CHECK (delete_after > created_at)
);

CREATE INDEX resume_access_events_recent_idx
  ON resume_access_events(created_at DESC);
CREATE INDEX resume_access_events_retention_idx
  ON resume_access_events(delete_after);
CREATE INDEX resume_access_events_session_idx
  ON resume_access_events(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX resume_access_events_invite_idx
  ON resume_access_events(invite_id) WHERE invite_id IS NOT NULL;
