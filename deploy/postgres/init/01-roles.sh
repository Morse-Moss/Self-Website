#!/usr/bin/env bash
set -Eeuo pipefail

read_secret() {
  local path="$1"
  test -s "$path"
  tr -d '\r\n' < "$path"
}

validate_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" || "$value" == *[!A-Za-z0-9_-]* ]]; then
    printf '%s\n' "${name}_INVALID" >&2
    exit 1
  fi
}

runtime_password="$(read_secret "${MORSE_DB_RUNTIME_PASSWORD_FILE:-/run/secrets/db_runtime_password}")"
worker_password="$(read_secret "${MORSE_DB_WORKER_PASSWORD_FILE:-/run/secrets/db_worker_password}")"
migration_password="$(read_secret "${MORSE_DB_MIGRATION_PASSWORD_FILE:-/run/secrets/db_migration_password}")"
ingest_password="$(read_secret "${MORSE_DB_INGEST_PASSWORD_FILE:-/run/secrets/db_ingest_password}")"
backup_password="$(read_secret "${MORSE_DB_BACKUP_PASSWORD_FILE:-/run/secrets/db_backup_password}")"

validate_secret DB_RUNTIME_PASSWORD "$runtime_password"
validate_secret DB_WORKER_PASSWORD "$worker_password"
validate_secret DB_MIGRATION_PASSWORD "$migration_password"
validate_secret DB_INGEST_PASSWORD "$ingest_password"
validate_secret DB_BACKUP_PASSWORD "$backup_password"

psql --set=runtime_password="$runtime_password" \
  --set=worker_password="$worker_password" \
  --set=migration_password="$migration_password" \
  --set=ingest_password="$ingest_password" \
  --set=backup_password="$backup_password" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'runtime') THEN
    CREATE ROLE runtime LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migration') THEN
    CREATE ROLE migration LOGIN SUPERUSER;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'worker') THEN
    CREATE ROLE worker LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingest') THEN
    CREATE ROLE ingest LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'backup') THEN
    CREATE ROLE backup LOGIN;
  END IF;
END
$$;

ALTER ROLE runtime PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE worker PASSWORD :'worker_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE migration PASSWORD :'migration_password' SUPERUSER;
ALTER ROLE ingest PASSWORD :'ingest_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE backup PASSWORD :'backup_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

ALTER SCHEMA public OWNER TO migration;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO migration;
GRANT USAGE ON SCHEMA public TO runtime, worker, ingest, backup;
GRANT CONNECT ON DATABASE revolution TO runtime, worker, migration, ingest, backup;

SQL
