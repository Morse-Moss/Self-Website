import process from 'node:process';

import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const configuredCleanupNow = process.env.MORSE_CLEANUP_NOW?.trim();
const cleanupDate = configuredCleanupNow ? new Date(configuredCleanupNow) : new Date();
if (Number.isNaN(cleanupDate.getTime())) {
  throw new Error('MORSE_CLEANUP_NOW must be a valid ISO timestamp.');
}
const cleanupNow = cleanupDate.toISOString();

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query('BEGIN');
  const interactionSearches = await client.query(
    'DELETE FROM interaction_searches WHERE delete_after <= $1::timestamptz',
    [cleanupNow],
  );
  const diagnoses = await client.query(
    'DELETE FROM diagnoses WHERE delete_after <= $1::timestamptz',
    [cleanupNow],
  );
  const interactionTurns = await client.query(
    'DELETE FROM interaction_turns WHERE delete_after <= $1::timestamptz',
    [cleanupNow],
  );
  const sessions = await client.query(
    'DELETE FROM access_sessions WHERE expires_at <= $1::timestamptz',
    [cleanupNow],
  );
  const invites = await client.query(
    `UPDATE invite_codes SET active = false
      WHERE expires_at <= $1::timestamptz AND active = true`,
    [cleanupNow],
  );
  const adminSessions = await client.query(
    'DELETE FROM admin_sessions WHERE expires_at <= $1::timestamptz',
    [cleanupNow],
  );
  const alertOutbox = await client.query(
    'DELETE FROM alert_outbox WHERE expires_at <= $1::timestamptz',
    [cleanupNow],
  );
  const accessAttempts = await client.query(
    'DELETE FROM access_attempts WHERE expires_at <= $1::timestamptz',
    [cleanupNow],
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({
    deletedSessions: sessions.rowCount ?? 0,
    deactivatedInvites: invites.rowCount ?? 0,
    deletedInteractionSearches: interactionSearches.rowCount ?? 0,
    deletedDiagnoses: diagnoses.rowCount ?? 0,
    deletedInteractionTurns: interactionTurns.rowCount ?? 0,
    deletedAdminSessions: adminSessions.rowCount ?? 0,
    deletedAlertOutbox: alertOutbox.rowCount ?? 0,
    deletedAccessAttempts: accessAttempts.rowCount ?? 0,
  }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
