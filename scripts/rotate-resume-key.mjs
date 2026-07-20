import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabasePool } from '../lib/server/db.ts';
import {
  getCurrentResumeDocument,
  readResumePdf,
  removeResumeCiphertext,
  writeResumeCiphertext,
} from '../lib/server/resume-storage.ts';

const ROTATION_LOCK = 'private-resume-key-rotation';
const AUDIT_DAYS = 30;

function auditDeleteAfter(now) {
  return new Date(now.getTime() + AUDIT_DAYS * 24 * 60 * 60 * 1000);
}

async function withRotationTransaction(pool, failureCode, run) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      [ROTATION_LOCK],
    );
    const result = await run(client);
    await client.query('COMMIT');
    committed = true;
    return result;
  } catch {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    throw new Error(failureCode);
  } finally {
    client.release();
  }
}

async function recordRotationEvent(client, eventType, resultCode, now) {
  await client.query(
    `INSERT INTO resume_access_events
       (event_type, result_code, device_info, created_at, delete_after)
     VALUES ($1, $2, '{}'::jsonb, $3, $4)`,
    [eventType, resultCode, now, auditDeleteAfter(now)],
  );
}

async function lockedDocuments(client, documentIds) {
  const result = await client.query(
    `SELECT id, storage_name, is_current
       FROM resume_documents
      WHERE id = ANY($1::uuid[])
      ORDER BY id
      FOR UPDATE`,
    [documentIds],
  );
  return result.rows;
}

function findDocument(rows, id) {
  return rows.find((row) => String(row.id) === id);
}

async function preparedRotationPersisted(pool, stored) {
  const result = await pool.query(
    `SELECT id, storage_name, cipher_sha256, key_version, is_current
       FROM resume_documents
      WHERE id = $1 AND is_current = false`,
    [stored.id],
  );
  const row = result.rows[0];
  return Boolean(
    row
    && String(row.id) === stored.id
    && String(row.storage_name) === stored.storageName
    && String(row.cipher_sha256) === stored.cipherSha256
    && Number(row.key_version) === stored.keyVersion
    && row.is_current === false
  );
}

async function currentDocumentId(pool) {
  const result = await pool.query(
    'SELECT id FROM resume_documents WHERE is_current = true',
  );
  return result.rows[0] ? String(result.rows[0].id) : null;
}

async function documentExists(pool, documentId) {
  const result = await pool.query(
    'SELECT id FROM resume_documents WHERE id = $1',
    [documentId],
  );
  return Boolean(result.rows[0]);
}

export async function prepareResumeKeyRotation(input) {
  if (!Number.isSafeInteger(input.oldKeyVersion) || input.oldKeyVersion < 1
    || !Number.isSafeInteger(input.newKeyVersion)
    || input.newKeyVersion <= input.oldKeyVersion) {
    throw new Error('RESUME_KEY_VERSION_NOT_ADVANCING');
  }
  const current = await getCurrentResumeDocument(input.pool);
  if (!current || current.keyVersion !== input.oldKeyVersion) {
    throw new Error('RESUME_CURRENT_KEY_VERSION_MISMATCH');
  }
  const readPdf = input.readPdf ?? readResumePdf;
  const plaintext = await readPdf({
    document: current,
    storageDir: input.storageDir,
    key: input.oldKey,
    expectedKeyVersion: input.oldKeyVersion,
  });
  const stored = await writeResumeCiphertext({
    storageDir: input.storageDir,
    pdf: plaintext,
    key: input.newKey,
    keyVersion: input.newKeyVersion,
    syncDirectory: input.syncDirectory,
  });
  try {
    await readPdf({
      document: { ...stored, uploadedAt: input.now },
      storageDir: input.storageDir,
      key: input.newKey,
      expectedKeyVersion: input.newKeyVersion,
    });
    await withRotationTransaction(input.pool, 'RESUME_KEY_ROTATION_FAILED', async (client) => {
      const currentResult = await client.query(
        `SELECT id
           FROM resume_documents
          WHERE is_current = true AND id = $1
          FOR UPDATE`,
        [current.id],
      );
      if (!currentResult.rows[0]) throw new Error('current document changed');
      await client.query(
        `INSERT INTO resume_documents
           (id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
            envelope_version, key_version, uploaded_at, uploaded_by_admin_session,
            activated_at, is_current)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, false)`,
        [
          stored.id,
          stored.storageName,
          stored.cipherSha256,
          stored.plaintextBytes,
          stored.ciphertextBytes,
          stored.envelopeVersion,
          stored.keyVersion,
          input.now,
          current.uploadedByAdminSession,
        ],
      );
      await recordRotationEvent(client, 'key_rotation_prepared', 'RESUME_KEY_ROTATION_PREPARED', input.now);
    });
  } catch {
    let persisted;
    try {
      persisted = await preparedRotationPersisted(input.pool, stored);
    } catch {
      throw new Error('RESUME_KEY_ROTATION_STATE_UNKNOWN');
    }
    if (!persisted) {
      const remove = input.removeCiphertext
        ?? ((storageDir, storageName) => removeResumeCiphertext(storageDir, storageName, {
          syncDirectory: input.syncDirectory,
        }));
      try {
        await remove(input.storageDir, stored.storageName);
      } catch {
        await recordStorageRecovery(input.pool, input.now);
      }
      throw new Error('RESUME_KEY_ROTATION_FAILED');
    }
  }
  return { previousDocumentId: current.id, preparedDocumentId: stored.id };
}

export async function activatePreparedResumeKey(input) {
  if (input.previousDocumentId === input.preparedDocumentId) {
    throw new Error('RESUME_KEY_ACTIVATION_FAILED');
  }
  try {
    return await withRotationTransaction(
      input.pool,
      'RESUME_KEY_ACTIVATION_FAILED',
      async (client) => {
        const rows = await lockedDocuments(client, [
          input.previousDocumentId,
          input.preparedDocumentId,
        ]);
        const previous = findDocument(rows, input.previousDocumentId);
        const prepared = findDocument(rows, input.preparedDocumentId);
        if (!previous || !prepared || previous.is_current !== true || prepared.is_current !== false) {
          throw new Error('rotation state mismatch');
        }
        await client.query(
          'UPDATE resume_documents SET is_current = false WHERE id = $1 AND is_current = true',
          [input.previousDocumentId],
        );
        await client.query(
          `UPDATE resume_documents
              SET is_current = true, activated_at = $2
            WHERE id = $1 AND is_current = false`,
          [input.preparedDocumentId, input.now],
        );
        await recordRotationEvent(client, 'key_rotation_activated', 'RESUME_KEY_ROTATION_ACTIVATED', input.now);
      },
    );
  } catch (error) {
    if (await currentDocumentId(input.pool).catch(() => null) === input.preparedDocumentId) return;
    throw error;
  }
}

export async function rollbackResumeKeyRotation(input) {
  if (input.previousDocumentId === input.activatedDocumentId) {
    throw new Error('RESUME_KEY_ROLLBACK_FAILED');
  }
  try {
    return await withRotationTransaction(
      input.pool,
      'RESUME_KEY_ROLLBACK_FAILED',
      async (client) => {
        const rows = await lockedDocuments(client, [
          input.previousDocumentId,
          input.activatedDocumentId,
        ]);
        const previous = findDocument(rows, input.previousDocumentId);
        const activated = findDocument(rows, input.activatedDocumentId);
        if (!previous || !activated || previous.is_current !== false || activated.is_current !== true) {
          throw new Error('rotation state mismatch');
        }
        await client.query(
          'UPDATE resume_documents SET is_current = false WHERE id = $1 AND is_current = true',
          [input.activatedDocumentId],
        );
        await client.query(
          `UPDATE resume_documents
              SET is_current = true, activated_at = $2
            WHERE id = $1 AND is_current = false`,
          [input.previousDocumentId, input.now],
        );
        await recordRotationEvent(client, 'key_rotation_rolled_back', 'RESUME_KEY_ROTATION_ROLLED_BACK', input.now);
      },
    );
  } catch (error) {
    if (await currentDocumentId(input.pool).catch(() => null) === input.previousDocumentId) return;
    throw error;
  }
}

async function recordStorageRecovery(pool, now) {
  await pool.query(
    `INSERT INTO resume_access_events
       (event_type, result_code, device_info, created_at, delete_after)
     VALUES ('storage_recovery', 'RESUME_RETIRED_CIPHERTEXT_ORPHANED', '{}'::jsonb, $1, $2)`,
    [now, auditDeleteAfter(now)],
  ).catch(() => undefined);
}

export async function finalizeResumeKeyRotation(input) {
  if (input.observedDocumentId !== input.activatedDocumentId) {
    throw new Error('RESUME_WEB_VERIFICATION_REQUIRED');
  }
  let retiredStorageName;
  try {
    await withRotationTransaction(input.pool, 'RESUME_KEY_FINALIZE_FAILED', async (client) => {
      const rows = await lockedDocuments(client, [
        input.activatedDocumentId,
        input.retiredDocumentId,
      ]);
      const activated = findDocument(rows, input.activatedDocumentId);
      const retired = findDocument(rows, input.retiredDocumentId);
      if (!activated || !retired || activated.is_current !== true || retired.is_current !== false) {
        throw new Error('rotation state mismatch');
      }
      retiredStorageName = String(retired.storage_name);
      await client.query(
        'DELETE FROM resume_documents WHERE id = $1 AND is_current = false',
        [input.retiredDocumentId],
      );
      await recordRotationEvent(client, 'key_rotation_finalized', 'RESUME_KEY_ROTATION_FINALIZED', input.now);
    });
  } catch (error) {
    const recovered = retiredStorageName
      && await currentDocumentId(input.pool).catch(() => null) === input.activatedDocumentId
      && !await documentExists(input.pool, input.retiredDocumentId).catch(() => true);
    if (!recovered) throw error;
  }
  try {
    const remove = input.removeCiphertext
      ?? ((storageDir, storageName) => removeResumeCiphertext(storageDir, storageName));
    await remove(input.storageDir, retiredStorageName);
  } catch {
    await recordStorageRecovery(input.pool, input.now);
  }
}

function positiveVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('RESUME_KEY_VERSION_INVALID');
  return version;
}

async function fileKey(fileName) {
  if (!fileName?.trim() || !path.isAbsolute(fileName.trim())) {
    throw new Error('RESUME_KEY_FILE_INVALID');
  }
  const encoded = (await readFile(fileName.trim(), 'utf8')).trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) {
    throw new Error('RESUME_KEY_FILE_INVALID');
  }
  return key;
}

export async function main({ args = process.argv.slice(2), env = process.env } = {}) {
  const [operation, firstId, secondId, observedId] = args;
  if (!['prepare', 'activate', 'rollback', 'finalize'].includes(operation)) {
    throw new Error('RESUME_KEY_ROTATION_OPERATION_INVALID');
  }
  const databaseUrl = env.DATABASE_URL?.trim();
  const storageDir = env.MORSE_RESUME_STORAGE_DIR?.trim();
  if (!databaseUrl || !storageDir || !path.isAbsolute(storageDir)) {
    throw new Error('RESUME_KEY_ROTATION_CONFIG_INVALID');
  }
  const pool = createDatabasePool(databaseUrl, { env, role: 'migration' });
  try {
    const now = new Date();
    if (operation === 'prepare') {
      await prepareResumeKeyRotation({
        pool,
        storageDir,
        oldKey: await fileKey(env.MORSE_RESUME_OLD_KEY_FILE),
        newKey: await fileKey(env.MORSE_RESUME_NEW_KEY_FILE),
        oldKeyVersion: positiveVersion(env.MORSE_RESUME_OLD_KEY_VERSION),
        newKeyVersion: positiveVersion(env.MORSE_RESUME_NEW_KEY_VERSION),
        now,
      });
    } else if (operation === 'activate') {
      await activatePreparedResumeKey({
        pool,
        previousDocumentId: firstId,
        preparedDocumentId: secondId,
        now,
      });
    } else if (operation === 'rollback') {
      await rollbackResumeKeyRotation({
        pool,
        previousDocumentId: firstId,
        activatedDocumentId: secondId,
        now,
      });
    } else {
      await finalizeResumeKeyRotation({
        pool,
        storageDir,
        activatedDocumentId: firstId,
        retiredDocumentId: secondId,
        observedDocumentId: observedId,
        now,
      });
    }
    console.log('RESUME_KEY_ROTATION_OK');
  } finally {
    await pool.end();
  }
}

const filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === filename) {
  main().catch((error) => {
    const message = /^[A-Z0-9_]+$/u.test(error?.message ?? '')
      ? error.message
      : 'RESUME_KEY_ROTATION_FAILED';
    console.error(message);
    process.exitCode = 1;
  });
}
