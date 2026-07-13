import process from 'node:process';

import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const client = new Client({ connectionString });

try {
  await client.connect();
  await client.query('BEGIN');
  const sessions = await client.query(
    'DELETE FROM access_sessions WHERE expires_at <= now()',
  );
  const invites = await client.query(
    'UPDATE invite_codes SET active = false WHERE expires_at <= now() AND active = true',
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({
    deletedSessions: sessions.rowCount ?? 0,
    deactivatedInvites: invites.rowCount ?? 0,
  }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
