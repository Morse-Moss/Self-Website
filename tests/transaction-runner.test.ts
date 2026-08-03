import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runPoolTransaction } from '../lib/server/transaction-runner.ts';

function client() {
  const calls: string[] = [];
  return {
    calls,
    async query(sql: string) {
      calls.push(sql);
      if (sql === 'COMMIT') throw new Error('commit transport lost');
      return { rows: [] };
    },
  };
}

test('transaction runner lets the caller recover after an uncertain commit', async () => {
  const database = client();
  const result = await runPoolTransaction({
    client: database,
    work: async () => 'durable-result',
    recoverAfterCommit: async () => ({ recovered: true, result: 'recovered-result' }),
  });

  assert.equal(result, 'recovered-result');
  assert.deepEqual(database.calls, ['BEGIN', 'COMMIT']);
});

test('transaction runner rolls back ordinary failures', async () => {
  const database = client();
  await assert.rejects(
    runPoolTransaction({
      client: database,
      work: async () => { throw new Error('work failed'); },
    }),
    /work failed/,
  );

  assert.deepEqual(database.calls, ['BEGIN', 'ROLLBACK']);
});

test('transaction runner rolls back when an uncertain commit cannot be recovered', async () => {
  const database = client();
  await assert.rejects(
    runPoolTransaction({
      client: database,
      work: async () => 'result',
      recoverAfterCommit: async () => ({ recovered: false }),
    }),
    /commit transport lost/,
  );

  assert.deepEqual(database.calls, ['BEGIN', 'COMMIT', 'ROLLBACK']);
});
