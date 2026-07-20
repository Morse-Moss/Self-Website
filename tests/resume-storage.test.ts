import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import {
  ResumeStorageError,
  readResumePdf,
  removeResumeCiphertext,
  writeResumeCiphertext,
} from '../lib/server/resume-storage.ts';
import { syntheticResumePdf } from './fixtures/synthetic-resume.ts';

const storageRoot = path.resolve('tmp', 'resume-tests');

async function withStorage(run: (storageDir: string) => Promise<void>): Promise<void> {
  const storageDir = path.join(storageRoot, randomUUID());
  try {
    await run(storageDir);
  } finally {
    await rm(storageDir, { force: true, recursive: true });
  }
}

function assertStorageError(error: unknown, code: string): boolean {
  assert.ok(error instanceof ResumeStorageError);
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  return true;
}

test('resume storage writes only ciphertext, verifies it, and removes it durably', async () => {
  await withStorage(async (storageDir) => {
    const syncCalls: string[] = [];
    const syncDirectory = async (directory: string) => { syncCalls.push(directory); };
    const pdf = syntheticResumePdf();
    const key = randomBytes(32);
    const stored = await writeResumeCiphertext({ storageDir, pdf, key, keyVersion: 5, syncDirectory });

    assert.match(stored.storageName, /^[0-9a-f-]{36}[.]morsepdf$/u);
    assert.equal(stored.plaintextBytes, pdf.length);
    assert.ok(stored.ciphertextBytes > pdf.length);
    assert.equal(stored.envelopeVersion, 1);
    assert.equal(stored.keyVersion, 5);
    assert.match(stored.cipherSha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(await readdir(storageDir), [stored.storageName]);
    const ciphertext = await readFile(path.join(storageDir, stored.storageName));
    assert.notEqual(ciphertext.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.deepEqual(await readResumePdf({
      document: { ...stored, uploadedAt: new Date(0) },
      storageDir,
      key,
      expectedKeyVersion: 5,
    }), pdf);

    if (process.platform !== 'win32') {
      assert.equal((await stat(path.join(storageDir, stored.storageName))).mode & 0o777, 0o600);
    }
    await removeResumeCiphertext(storageDir, stored.storageName, { syncDirectory });
    assert.deepEqual(await readdir(storageDir), []);
    assert.equal(syncCalls.length, 2);
  });
});

test('resume storage rejects unsafe names, checksum changes, and authenticated non-PDF data', async () => {
  await withStorage(async (storageDir) => {
    const key = randomBytes(32);
    const stored = await writeResumeCiphertext({
      storageDir,
      pdf: syntheticResumePdf(),
      key,
      keyVersion: 1,
      syncDirectory: async () => undefined,
    });
    const document = { ...stored, uploadedAt: new Date(0) };

    await assert.rejects(
      readResumePdf({
        document: { ...document, storageName: '../resume.morsepdf' },
        storageDir,
        key,
        expectedKeyVersion: 1,
      }),
      (error) => assertStorageError(error, 'RESUME_STORAGE_NAME_INVALID'),
    );

    const filePath = path.join(storageDir, stored.storageName);
    const changed = await readFile(filePath);
    changed[changed.length - 1] ^= 0xff;
    await writeFile(filePath, changed);
    await assert.rejects(
      readResumePdf({ document, storageDir, key, expectedKeyVersion: 1 }),
      (error) => assertStorageError(error, 'RESUME_CIPHERTEXT_MISMATCH'),
    );

    const nonPdf = await writeResumeCiphertext({
      storageDir,
      pdf: Buffer.from('synthetic but not a PDF', 'ascii'),
      key,
      keyVersion: 1,
      syncDirectory: async () => undefined,
    });
    await assert.rejects(
      readResumePdf({
        document: { ...nonPdf, uploadedAt: new Date(0) },
        storageDir,
        key,
        expectedKeyVersion: 1,
      }),
      (error) => assertStorageError(error, 'RESUME_PDF_INVALID'),
    );
  });
});

test('resume storage cleans temporary and renamed ciphertext when durability sync fails', async () => {
  await withStorage(async (storageDir) => {
    await assert.rejects(
      writeResumeCiphertext({
        storageDir,
        pdf: syntheticResumePdf(),
        key: randomBytes(32),
        keyVersion: 1,
        syncDirectory: async () => { throw new Error('forced directory sync failure'); },
      }),
      /forced directory sync failure/u,
    );
    assert.deepEqual(await readdir(storageDir), []);
  });
});
