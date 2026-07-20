import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  activatePreparedResumeKey,
  finalizeResumeKeyRotation,
  prepareResumeKeyRotation,
  rollbackResumeKeyRotation,
} from '../scripts/rotate-resume-key.mjs';
import {
  readResumePdf,
  writeResumeCiphertext,
} from '../lib/server/resume-storage.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';

type QueryResult = { rows: Array<Record<string, unknown>> };

class ScriptedPool {
  readonly queries: Array<{ params: unknown[]; sql: string }> = [];
  private readonly handler: (sql: string, params: unknown[]) => QueryResult;

  constructor(handler: (sql: string, params: unknown[]) => QueryResult) {
    this.handler = handler;
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    this.queries.push({ sql, params });
    return this.handler(sql, params);
  }

  async connect(): Promise<{ query: ScriptedPool['query']; release(): void }> {
    return { query: this.query.bind(this), release() {} };
  }
}

const storageRoot = path.resolve('tmp', 'resume-tests');

async function withStorage(run: (storageDir: string) => Promise<void>): Promise<void> {
  const storageDir = path.join(storageRoot, randomUUID());
  try {
    await run(storageDir);
  } finally {
    await rm(storageDir, { force: true, recursive: true });
  }
}

function row(stored: Awaited<ReturnType<typeof writeResumeCiphertext>>, isCurrent: boolean) {
  return {
    id: stored.id,
    storage_name: stored.storageName,
    cipher_sha256: stored.cipherSha256,
    plaintext_bytes: stored.plaintextBytes,
    ciphertext_bytes: stored.ciphertextBytes,
    envelope_version: stored.envelopeVersion,
    key_version: stored.keyVersion,
    uploaded_at: new Date('2026-07-20T00:00:00Z'),
    uploaded_by_admin_session: '00000000-0000-4000-8000-000000000001',
    is_current: isCurrent,
  };
}

test('resume key rotation prepares verified ciphertext without changing the current pointer', async () => {
  await withStorage(async (storageDir) => {
    const oldKey = randomBytes(32);
    const oldStored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key: oldKey,
      keyVersion: 1,
      syncDirectory: async () => undefined,
    });
    const current = row(oldStored, true);
    const pool = new ScriptedPool((sql) => {
      if (/WHERE is_current = true/u.test(sql)) return { rows: [current] };
      return { rows: [] };
    });

    const prepared = await prepareResumeKeyRotation({
      pool,
      storageDir,
      oldKey,
      newKey: randomBytes(32),
      oldKeyVersion: 1,
      newKeyVersion: 2,
      now: new Date('2026-07-20T00:00:00Z'),
      syncDirectory: async () => undefined,
    });

    assert.equal(prepared.previousDocumentId, oldStored.id);
    assert.notEqual(prepared.preparedDocumentId, oldStored.id);
    assert.equal((await readdir(storageDir)).length, 2);
    assert.ok(pool.queries.some(({ sql }) => /INSERT INTO resume_documents/u.test(sql)));
    assert.ok(pool.queries.some(({ params }) => params.includes('key_rotation_prepared')));
    assert.ok(pool.queries.every(({ sql }) => !/SET is_current = true/u.test(sql)));
  });
});

test('resume key rotation removes the new orphan when prepared metadata insertion fails', async () => {
  await withStorage(async (storageDir) => {
    const oldKey = randomBytes(32);
    const oldStored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key: oldKey,
      keyVersion: 3,
      syncDirectory: async () => undefined,
    });
    const current = row(oldStored, true);
    const pool = new ScriptedPool((sql) => {
      if (/WHERE is_current = true/u.test(sql)) return { rows: [current] };
      if (/INSERT INTO resume_documents/u.test(sql)) throw new Error('forced insert failure');
      return { rows: [] };
    });

    await assert.rejects(
      prepareResumeKeyRotation({
        pool,
        storageDir,
        oldKey,
        newKey: randomBytes(32),
        oldKeyVersion: 3,
        newKeyVersion: 4,
        now: new Date('2026-07-20T00:00:00Z'),
        syncDirectory: async () => undefined,
      }),
      /RESUME_KEY_ROTATION_FAILED/u,
    );
    assert.deepEqual(await readdir(storageDir), [oldStored.storageName]);
    assert.ok(pool.queries.some(({ sql }) => sql === 'ROLLBACK'));
  });
});

test('resume key rotation recovers a durable prepare when COMMIT acknowledgement is lost', async () => {
  await withStorage(async (storageDir) => {
    const oldKey = randomBytes(32);
    const oldStored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key: oldKey,
      keyVersion: 7,
      syncDirectory: async () => undefined,
    });
    const current = row(oldStored, true);
    let preparedRow: Record<string, unknown> | undefined;
    let commitLost = false;
    const pool = new ScriptedPool((sql, params) => {
      if (/WHERE is_current = true/u.test(sql)) return { rows: [current] };
      if (/INSERT INTO resume_documents/u.test(sql)) {
        preparedRow = {
          id: params[0],
          storage_name: params[1],
          cipher_sha256: params[2],
          key_version: params[6],
          is_current: false,
        };
      }
      if (/WHERE id = \$1 AND is_current = false/u.test(sql)) {
        return { rows: preparedRow ? [preparedRow] : [] };
      }
      if (sql === 'COMMIT' && !commitLost) {
        commitLost = true;
        throw new Error('lost COMMIT acknowledgement');
      }
      return { rows: [] };
    });

    const prepared = await prepareResumeKeyRotation({
      pool,
      storageDir,
      oldKey,
      newKey: randomBytes(32),
      oldKeyVersion: 7,
      newKeyVersion: 8,
      now: new Date('2026-07-20T00:00:00Z'),
      syncDirectory: async () => undefined,
    });

    assert.equal(prepared.preparedDocumentId, preparedRow?.id);
    assert.equal((await readdir(storageDir)).length, 2);
  });
});

test('resume key rotation removes the new orphan when verification fails', async () => {
  await withStorage(async (storageDir) => {
    const oldKey = randomBytes(32);
    const oldStored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key: oldKey,
      keyVersion: 5,
      syncDirectory: async () => undefined,
    });
    const current = row(oldStored, true);
    const pool = new ScriptedPool((sql) => {
      if (/WHERE is_current = true/u.test(sql)) return { rows: [current] };
      return { rows: [] };
    });

    await assert.rejects(
      prepareResumeKeyRotation({
        pool,
        storageDir,
        oldKey,
        newKey: randomBytes(32),
        oldKeyVersion: 5,
        newKeyVersion: 6,
        now: new Date('2026-07-20T00:00:00Z'),
        syncDirectory: async () => undefined,
        readPdf: async (input: Parameters<typeof readResumePdf>[0]) => {
          if (input.document.id !== oldStored.id) throw new Error('forced verification failure');
          return readResumePdf(input);
        },
      }),
      /RESUME_KEY_ROTATION_FAILED/u,
    );
    assert.deepEqual(await readdir(storageDir), [oldStored.storageName]);
  });
});

test('resume key rotation records recovery when failed prepare cleanup cannot remove ciphertext', async () => {
  await withStorage(async (storageDir) => {
    const oldKey = randomBytes(32);
    const oldStored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key: oldKey,
      keyVersion: 9,
      syncDirectory: async () => undefined,
    });
    const current = row(oldStored, true);
    const pool = new ScriptedPool((sql) => {
      if (/WHERE is_current = true/u.test(sql)) return { rows: [current] };
      if (/INSERT INTO resume_documents/u.test(sql)) throw new Error('forced insert failure');
      return { rows: [] };
    });

    await assert.rejects(
      prepareResumeKeyRotation({
        pool,
        storageDir,
        oldKey,
        newKey: randomBytes(32),
        oldKeyVersion: 9,
        newKeyVersion: 10,
        now: new Date('2026-07-20T00:00:00Z'),
        syncDirectory: async () => undefined,
        removeCiphertext: async () => { throw new Error('forced cleanup failure'); },
      }),
      /RESUME_KEY_ROTATION_FAILED/u,
    );
    assert.ok(pool.queries.some(({ sql }) => /storage_recovery/u.test(sql)));
  });
});

test('resume key rotation activation, rollback, and finalize use locked transactions', async () => {
  const previousId = '00000000-0000-4000-8000-000000000010';
  const preparedId = '00000000-0000-4000-8000-000000000011';
  const documents = [
    { id: previousId, storage_name: `${previousId}.morsepdf`, is_current: true },
    { id: preparedId, storage_name: `${preparedId}.morsepdf`, is_current: false },
  ];
  const pool = new ScriptedPool((sql, params) => {
    if (/FOR UPDATE/u.test(sql)) return { rows: documents };
    if (/SET is_current = false/u.test(sql)) {
      const document = documents.find(({ id }) => id === params[0]);
      if (document) document.is_current = false;
    }
    if (/SET is_current = true/u.test(sql)) {
      const document = documents.find(({ id }) => id === params[0]);
      if (document) document.is_current = true;
    }
    return { rows: [] };
  });

  await activatePreparedResumeKey({ pool, previousDocumentId: previousId, preparedDocumentId: preparedId, now: new Date(0) });
  await rollbackResumeKeyRotation({ pool, previousDocumentId: previousId, activatedDocumentId: preparedId, now: new Date(0) });
  await activatePreparedResumeKey({ pool, previousDocumentId: previousId, preparedDocumentId: preparedId, now: new Date(0) });
  await finalizeResumeKeyRotation({
    pool,
    storageDir: path.join(storageRoot, 'not-used'),
    activatedDocumentId: preparedId,
    retiredDocumentId: previousId,
    observedDocumentId: preparedId,
    now: new Date(0),
    removeCiphertext: async () => undefined,
  });

  assert.equal(pool.queries.filter(({ sql }) => sql === 'BEGIN').length, 4);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'COMMIT').length, 4);
  assert.ok(pool.queries.filter(({ sql }) => /pg_advisory_xact_lock/u.test(sql)).length >= 4);
  assert.ok(pool.queries.some(({ params }) => params.includes('key_rotation_activated')));
  assert.ok(pool.queries.some(({ params }) => params.includes('key_rotation_rolled_back')));
  assert.ok(pool.queries.some(({ params }) => params.includes('key_rotation_finalized')));
});

test('resume key rotation rolls back pointer activation failures and requires Web observation to finalize', async () => {
  const previousId = '00000000-0000-4000-8000-000000000020';
  const preparedId = '00000000-0000-4000-8000-000000000021';
  const documents = [
    { id: previousId, storage_name: `${previousId}.morsepdf`, is_current: true },
    { id: preparedId, storage_name: `${preparedId}.morsepdf`, is_current: false },
  ];
  const pool = new ScriptedPool((sql) => {
    if (/FOR UPDATE/u.test(sql)) return { rows: documents };
    if (/SET is_current = true/u.test(sql)) throw new Error('forced pointer failure');
    return { rows: [] };
  });

  await assert.rejects(
    activatePreparedResumeKey({ pool, previousDocumentId: previousId, preparedDocumentId: preparedId, now: new Date(0) }),
    /RESUME_KEY_ACTIVATION_FAILED/u,
  );
  assert.ok(pool.queries.some(({ sql }) => sql === 'ROLLBACK'));

  await assert.rejects(
    finalizeResumeKeyRotation({
      pool,
      storageDir: storageRoot,
      activatedDocumentId: preparedId,
      retiredDocumentId: previousId,
      observedDocumentId: previousId,
      now: new Date(0),
      removeCiphertext: async () => undefined,
    }),
    /RESUME_WEB_VERIFICATION_REQUIRED/u,
  );
});

test('resume key activation and rollback recover lost COMMIT acknowledgements', async () => {
  const previousId = '00000000-0000-4000-8000-000000000040';
  const preparedId = '00000000-0000-4000-8000-000000000041';
  const documents = [
    { id: previousId, storage_name: `${previousId}.morsepdf`, is_current: true },
    { id: preparedId, storage_name: `${preparedId}.morsepdf`, is_current: false },
  ];
  let loseCommit = true;
  const pool = new ScriptedPool((sql, params) => {
    if (/FOR UPDATE/u.test(sql)) return { rows: documents };
    if (/SELECT id FROM resume_documents WHERE is_current = true/u.test(sql)) {
      return { rows: documents.filter(({ is_current }) => is_current) };
    }
    if (/SET is_current = false/u.test(sql)) {
      const document = documents.find(({ id }) => id === params[0]);
      if (document) document.is_current = false;
    }
    if (/SET is_current = true/u.test(sql)) {
      const document = documents.find(({ id }) => id === params[0]);
      if (document) document.is_current = true;
    }
    if (sql === 'COMMIT' && loseCommit) {
      loseCommit = false;
      throw new Error('lost COMMIT acknowledgement');
    }
    return { rows: [] };
  });

  await activatePreparedResumeKey({
    pool,
    previousDocumentId: previousId,
    preparedDocumentId: preparedId,
    now: new Date(0),
  });
  assert.equal(documents.find(({ is_current }) => is_current)?.id, preparedId);

  loseCommit = true;
  await rollbackResumeKeyRotation({
    pool,
    previousDocumentId: previousId,
    activatedDocumentId: preparedId,
    now: new Date(0),
  });
  assert.equal(documents.find(({ is_current }) => is_current)?.id, previousId);
});

test('resume key rotation records storage recovery when retired ciphertext deletion fails', async () => {
  const retiredId = '00000000-0000-4000-8000-000000000030';
  const activatedId = '00000000-0000-4000-8000-000000000031';
  const documents = [
    { id: retiredId, storage_name: `${retiredId}.morsepdf`, is_current: false },
    { id: activatedId, storage_name: `${activatedId}.morsepdf`, is_current: true },
  ];
  const pool = new ScriptedPool((sql) => {
    if (/FOR UPDATE/u.test(sql)) return { rows: documents };
    return { rows: [] };
  });

  await finalizeResumeKeyRotation({
    pool,
    storageDir: storageRoot,
    activatedDocumentId: activatedId,
    retiredDocumentId: retiredId,
    observedDocumentId: activatedId,
    now: new Date(0),
    removeCiphertext: async () => { throw new Error('forced retired-file deletion failure'); },
  });

  assert.ok(pool.queries.some(({ sql }) => /storage_recovery/u.test(sql)));
});

test('resume key rotation finalization recovers a durable delete when COMMIT acknowledgement is lost', async () => {
  const retiredId = '00000000-0000-4000-8000-000000000050';
  const activatedId = '00000000-0000-4000-8000-000000000051';
  const documents = [
    { id: retiredId, storage_name: `${retiredId}.morsepdf`, is_current: false },
    { id: activatedId, storage_name: `${activatedId}.morsepdf`, is_current: true },
  ];
  let commitLost = false;
  const removed: string[] = [];
  const pool = new ScriptedPool((sql, params) => {
    if (/FOR UPDATE/u.test(sql)) return { rows: documents };
    if (/DELETE FROM resume_documents/u.test(sql)) {
      const index = documents.findIndex(({ id }) => id === params[0]);
      if (index >= 0) documents.splice(index, 1);
    }
    if (/SELECT id FROM resume_documents WHERE is_current = true/u.test(sql)) {
      return { rows: documents.filter(({ is_current }) => is_current) };
    }
    if (/SELECT id FROM resume_documents WHERE id = \$1/u.test(sql)) {
      return { rows: documents.filter(({ id }) => id === params[0]) };
    }
    if (sql === 'COMMIT' && !commitLost) {
      commitLost = true;
      throw new Error('lost COMMIT acknowledgement');
    }
    return { rows: [] };
  });

  await finalizeResumeKeyRotation({
    pool,
    storageDir: storageRoot,
    activatedDocumentId: activatedId,
    retiredDocumentId: retiredId,
    observedDocumentId: activatedId,
    now: new Date(0),
    removeCiphertext: async (_storageDir: string, storageName: string) => {
      removed.push(storageName);
    },
  });

  assert.deepEqual(removed, [`${retiredId}.morsepdf`]);
});

test('resume key rotation CLI owns and closes its one-shot database pool', async () => {
  const source = await readFile(
    path.resolve('scripts', 'rotate-resume-key.mjs'),
    'utf8',
  );
  assert.match(source, /createDatabasePool\(databaseUrl, \{ env, role: 'migration' \}\)/u);
  assert.match(source, /finally \{\s*await pool[.]end\(\);\s*\}/u);
  assert.doesNotMatch(source, /getPool\(/u);
});
