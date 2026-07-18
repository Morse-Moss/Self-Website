import { randomUUID } from 'node:crypto';
import process from 'node:process';

import pg from 'pg';

import { createDatabaseClientConfig } from '../lib/server/db.ts';

import { hashSecret } from '../lib/server/security.ts';

const { Client } = pg;

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function boundedInteger(name, fallback, min, max) {
  const value = Number(argument(name, String(fallback)));
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`--${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

const connectionString = process.env.DATABASE_URL;
const inviteCode = process.env.MORSE_NEW_INVITE_CODE?.trim();
const label = argument('label', 'private-invite');
const hours = boundedInteger('hours', 72, 1, 720);
const maxSessions = boundedInteger('max-sessions', 3, 1, 100);

if (!connectionString) throw new Error('DATABASE_URL is required.');
if (!inviteCode || inviteCode.length < 8 || inviteCode.length > 128) {
  throw new Error('MORSE_NEW_INVITE_CODE must contain 8 to 128 characters.');
}
if (!label?.trim()) throw new Error('--label must not be empty.');

const id = randomUUID();
const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
const client = new Client(createDatabaseClientConfig(connectionString, {
  env: process.env,
  role: 'migration',
}));

try {
  await client.connect();
  await client.query(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count)
     VALUES ($1, $2, $3, true, $4, $5, 0)`,
    [id, hashSecret(inviteCode), label.trim(), expiresAt, maxSessions],
  );
  console.log(JSON.stringify({ id, label: label.trim(), expiresAt, maxSessions }));
} finally {
  await client.end();
}
