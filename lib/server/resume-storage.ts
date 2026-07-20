import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

import { decryptResumePdf, encryptResumePdf } from './resume-crypto.ts';

const STORAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]morsepdf$/u;

export type ResumeStorageErrorCode =
  | 'RESUME_STORAGE_NAME_INVALID'
  | 'RESUME_CIPHERTEXT_UNAVAILABLE'
  | 'RESUME_CIPHERTEXT_MISMATCH'
  | 'RESUME_PDF_INVALID';

export class ResumeStorageError extends Error {
  readonly code: ResumeStorageErrorCode;

  constructor(code: ResumeStorageErrorCode) {
    super(code);
    this.name = 'ResumeStorageError';
    this.code = code;
  }
}

export interface ResumeDocumentRow {
  id: string;
  storageName: string;
  cipherSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  envelopeVersion: 1;
  keyVersion: number;
  uploadedAt: Date;
  uploadedByAdminSession?: string;
  isCurrent?: boolean;
}

export interface StoredResume {
  id: string;
  storageName: string;
  cipherSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  envelopeVersion: 1;
  keyVersion: number;
}

type SyncDirectory = (storageDir: string) => Promise<void>;

export interface WriteResumeCiphertextInput {
  storageDir: string;
  pdf: Buffer;
  key: Buffer;
  keyVersion: number;
  syncDirectory?: SyncDirectory;
}

export interface ReadResumePdfInput {
  document: ResumeDocumentRow;
  storageDir: string;
  key: Buffer;
  expectedKeyVersion: number;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

export interface ResumeQueryPool {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

async function syncResumeDirectory(storageDir: string): Promise<void> {
  const handle = await open(storageDir, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function storagePath(storageDir: string, storageName: string): string {
  if (!STORAGE_NAME.test(storageName) || path.basename(storageName) !== storageName) {
    throw new ResumeStorageError('RESUME_STORAGE_NAME_INVALID');
  }
  return path.join(storageDir, storageName);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function writeResumeCiphertext(
  input: WriteResumeCiphertextInput,
): Promise<StoredResume> {
  await mkdir(input.storageDir, { recursive: true, mode: 0o700 });
  const envelope = encryptResumePdf(input.pdf, input.key, input.keyVersion);
  const id = randomUUID();
  const storageName = `${id}.morsepdf`;
  const temporaryPath = path.join(input.storageDir, `${storageName}.tmp`);
  const finalPath = storagePath(input.storageDir, storageName);
  const directorySync = input.syncDirectory ?? syncResumeDirectory;
  const handle = await open(temporaryPath, 'wx', 0o600);
  let closed = false;
  let renamed = false;
  try {
    await handle.writeFile(envelope);
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryPath, finalPath);
    renamed = true;
    await directorySync(input.storageDir);
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (renamed) await rm(finalPath, { force: true }).catch(() => undefined);
    throw error;
  }

  return {
    id,
    storageName,
    cipherSha256: sha256(envelope),
    plaintextBytes: input.pdf.length,
    ciphertextBytes: envelope.length,
    envelopeVersion: 1,
    keyVersion: input.keyVersion,
  };
}

export async function readResumePdf(input: ReadResumePdfInput): Promise<Buffer> {
  const filePath = storagePath(input.storageDir, input.document.storageName);
  let envelope: Buffer;
  try {
    envelope = await readFile(filePath);
  } catch {
    throw new ResumeStorageError('RESUME_CIPHERTEXT_UNAVAILABLE');
  }
  if (sha256(envelope) !== input.document.cipherSha256) {
    throw new ResumeStorageError('RESUME_CIPHERTEXT_MISMATCH');
  }
  const pdf = decryptResumePdf(envelope, input.key, input.expectedKeyVersion);
  if (pdf.length < 6 || pdf.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ResumeStorageError('RESUME_PDF_INVALID');
  }
  return pdf;
}

export async function removeResumeCiphertext(
  storageDir: string,
  storageName: string,
  options: { syncDirectory?: SyncDirectory } = {},
): Promise<void> {
  await rm(storagePath(storageDir, storageName), { force: true });
  await (options.syncDirectory ?? syncResumeDirectory)(storageDir);
}

function numberValue(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new ResumeStorageError('RESUME_CIPHERTEXT_UNAVAILABLE');
  }
  return number;
}

export function mapResumeDocumentRow(row: Record<string, unknown>): ResumeDocumentRow {
  return {
    id: String(row.id),
    storageName: String(row.storage_name),
    cipherSha256: String(row.cipher_sha256),
    plaintextBytes: numberValue(row.plaintext_bytes),
    ciphertextBytes: numberValue(row.ciphertext_bytes),
    envelopeVersion: numberValue(row.envelope_version) as 1,
    keyVersion: numberValue(row.key_version),
    uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at : new Date(String(row.uploaded_at)),
    uploadedByAdminSession: row.uploaded_by_admin_session
      ? String(row.uploaded_by_admin_session)
      : undefined,
    isCurrent: typeof row.is_current === 'boolean' ? row.is_current : undefined,
  };
}

export async function getCurrentResumeDocument(
  pool: ResumeQueryPool,
): Promise<ResumeDocumentRow | null> {
  const result = await pool.query(
    `SELECT id, storage_name, cipher_sha256, plaintext_bytes, ciphertext_bytes,
            envelope_version, key_version, uploaded_at, uploaded_by_admin_session, is_current
       FROM resume_documents
      WHERE is_current = true`,
  );
  return result.rows[0] ? mapResumeDocumentRow(result.rows[0]) : null;
}
