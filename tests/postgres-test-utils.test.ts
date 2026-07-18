import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import pg from 'pg';

import { createDisposablePostgresDatabase } from './postgres-test-utils.ts';

const { Client } = pg;

test('disposable database lets closing clients drain before forced cleanup', async () => {
  const database = await createDisposablePostgresDatabase();
  const client = new Client({ connectionString: database.connectionString });
  const errors: string[] = [];
  client.on('error', (error) => errors.push(error.code ?? error.name));
  let closeClient: Promise<void> | undefined;
  try {
    await client.connect();
    closeClient = delay(150).then(() => client.end());
    await database.dispose();
    await closeClient;
    assert.deepEqual(errors, []);
  } finally {
    await (closeClient ?? client.end()).catch(() => undefined);
    await database.dispose();
  }
});
