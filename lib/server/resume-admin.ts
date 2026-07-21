import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { disableResumeInvite } from './resume-access.ts';
import { hashSecret } from './security.ts';
import {
  readResumePdf,
  removeResumeCiphertext,
  writeResumeCiphertext,
  type ResumeDocumentRow,
} from './resume-storage.ts';

export class ResumeAdminInputError extends Error {
  constructor() {
    super('INVALID_RESUME_PDF');
    this.name = 'ResumeAdminInputError';
  }
}

export function validateFinalPdf(fileName: string, mimeType: string, pdf: Buffer, maxBytes: number): void {
  if (
    !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !/\.pdf$/iu.test(fileName) || mimeType !== 'application/pdf'
    || pdf.length < 6 || pdf.length > maxBytes
    || pdf.subarray(0, 5).toString('ascii') !== '%PDF-'
  ) throw new ResumeAdminInputError();
}

export interface AdminResumeDocument {
  id: string;
  cipherSha256: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  keyVersion: number;
  uploadedAt: string;
  isCurrent: true;
}

interface ReplaceCurrentResumeInput {
  pool: Pool;
  adminSessionId: string;
  fileName: string;
  mimeType: string;
  pdf: Buffer;
  maxPdfBytes: number;
  storageDir: string;
  key: Buffer;
  keyVersion: number;
  auditRetentionDays: number;
  syncDirectory?: (directory: string) => Promise<void>;
  removeCiphertext?: (directory: string, name: string) => Promise<void>;
  now?: Date;
}

function deleteAfter(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60_000);
}

async function insertEvent(client: PoolClient, type: string, code: string, now: Date, days: number) {
  await client.query(
    `INSERT INTO resume_access_events (event_type,result_code,created_at,delete_after)
     VALUES ($1,$2,$3,$4)`,
    [type, code, now, deleteAfter(now, days)],
  );
}

async function recovery(pool: Pool, code: string, now: Date, days: number) {
  await pool.query(
    `INSERT INTO resume_access_events (event_type,result_code,created_at,delete_after)
     VALUES ('storage_recovery',$1,$2,$3)`,
    [code, now, deleteAfter(now, days)],
  ).catch(() => undefined);
}

export async function replaceCurrentResume(input: ReplaceCurrentResumeInput): Promise<AdminResumeDocument> {
  validateFinalPdf(input.fileName, input.mimeType, input.pdf, input.maxPdfBytes);
  const now = input.now ?? new Date();
  const syncDirectory = input.syncDirectory ?? (process.platform === 'win32'
    ? async () => undefined
    : undefined);
  const stored = await writeResumeCiphertext({
    storageDir: input.storageDir,
    pdf: input.pdf,
    key: input.key,
    keyVersion: input.keyVersion,
    syncDirectory,
  });
  await readResumePdf({
    storageDir: input.storageDir,
    document: { ...stored, uploadedAt: now },
    key: input.key,
    expectedKeyVersion: input.keyVersion,
  });
  const remove = input.removeCiphertext ?? ((directory: string, name: string) => (
    removeResumeCiphertext(directory, name, { syncDirectory })
  ));
  const client = await input.pool.connect();
  let committed = false;
  let old: { id: string; storage_name: string } | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('resume:current-document',0))");
    const current = await client.query<{ id: string; storage_name: string }>(
      'SELECT id,storage_name FROM resume_documents WHERE is_current=true FOR UPDATE',
    );
    old = current.rows[0];
    await client.query('UPDATE resume_documents SET is_current=false WHERE is_current=true');
    await client.query(
      `INSERT INTO resume_documents
       (id,storage_name,cipher_sha256,plaintext_bytes,ciphertext_bytes,envelope_version,key_version,uploaded_at,uploaded_by_admin_session,is_current)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,
      [stored.id, stored.storageName, stored.cipherSha256, stored.plaintextBytes, stored.ciphertextBytes, stored.envelopeVersion, stored.keyVersion, now, input.adminSessionId],
    );
    if (old) await client.query('DELETE FROM resume_documents WHERE id=$1', [old.id]);
    await insertEvent(client, old ? 'document_replaced' : 'document_uploaded', 'OK', now, input.auditRetentionDays);
    await client.query('COMMIT');
    committed = true;
  } catch (error) {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    const persisted = await input.pool.query(
      'SELECT 1 FROM resume_documents WHERE id=$1 AND is_current=true',
      [stored.id],
    ).then((result) => result.rowCount === 1, () => false);
    if (persisted) {
      committed = true;
    } else {
      try { await remove(input.storageDir, stored.storageName); } catch {
        await recovery(input.pool, 'NEW_CIPHERTEXT_CLEANUP_FAILED', now, input.auditRetentionDays);
      }
      throw error;
    }
  } finally {
    client.release();
  }
  if (old) {
    try { await remove(input.storageDir, old.storage_name); } catch {
      await recovery(input.pool, 'RETIRED_CIPHERTEXT_CLEANUP_FAILED', now, input.auditRetentionDays);
    }
  }
  return {
    id: stored.id,
    cipherSha256: stored.cipherSha256,
    plaintextBytes: stored.plaintextBytes,
    ciphertextBytes: stored.ciphertextBytes,
    keyVersion: stored.keyVersion,
    uploadedAt: now.toISOString(),
    isCurrent: true,
  };
}

export interface CreateResumeInviteInput {
  trustedPersonNote: string;
  adminSessionId: string;
  auditRetentionDays: number;
  now?: Date;
}

export async function createResumeInvite(pool: Pool, input: CreateResumeInviteInput) {
  const note = typeof input.trustedPersonNote === 'string' ? input.trustedPersonNote.trim() : '';
  if (!note || note.length > 200) throw new Error('INVALID_RESUME_INVITE');
  const now = input.now ?? new Date();
  const code = randomBytes(18).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO resume_invites (id,code_hash,trusted_person_note,created_at,expires_at,created_by_admin_session)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, hashSecret(code), note, now, expiresAt, input.adminSessionId],
    );
    await client.query(
      `INSERT INTO resume_access_events (event_type,result_code,invite_id,created_at,delete_after)
       VALUES ('invite_created','OK',$1,$2,$3)`,
      [id, now, deleteAfter(now, input.auditRetentionDays)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
  return {
    id, code, trustedPersonNote: note, expiresAt,
    disable: (adminSessionId: string) => disableResumeInvite(pool, id, adminSessionId),
  };
}

export async function getAdminResumeDashboard(pool: Pool, now = new Date()) {
  const [documents, invites, events] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT id,cipher_sha256,plaintext_bytes,ciphertext_bytes,key_version,uploaded_at,is_current
       FROM resume_documents WHERE is_current=true`,
    ),
    pool.query<Record<string, unknown>>(
      `SELECT id,trusted_person_note,created_at,expires_at,redeemed_at,disabled_at
       FROM resume_invites ORDER BY created_at DESC LIMIT 100`,
    ),
    pool.query<Record<string, unknown>>(
      `SELECT id,event_type,result_code,invite_id,session_id,source_ip,user_agent,device_info,created_at
       FROM resume_access_events WHERE created_at >= $1 ORDER BY created_at DESC,id DESC LIMIT 100`,
      [new Date(now.getTime() - 30 * 24 * 60 * 60_000)],
    ),
  ]);
  const document = documents.rows[0] ? {
    id: String(documents.rows[0].id), cipherSha256: String(documents.rows[0].cipher_sha256),
    plaintextBytes: Number(documents.rows[0].plaintext_bytes), ciphertextBytes: Number(documents.rows[0].ciphertext_bytes),
    keyVersion: Number(documents.rows[0].key_version), uploadedAt: (documents.rows[0].uploaded_at as Date).toISOString(), isCurrent: true,
  } : null;
  return {
    document,
    invites: invites.rows.map((row) => ({
      id: String(row.id), trustedPersonNote: String(row.trusted_person_note),
      createdAt: (row.created_at as Date).toISOString(), expiresAt: (row.expires_at as Date).toISOString(),
      redeemedAt: row.redeemed_at ? (row.redeemed_at as Date).toISOString() : null,
      disabledAt: row.disabled_at ? (row.disabled_at as Date).toISOString() : null,
    })),
    events: events.rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      resultCode: String(row.result_code),
      ip: row.source_ip ? String(row.source_ip) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      deviceInfo: row.device_info as Record<string, string>,
      createdAt: (row.created_at as Date).toISOString(),
    })),
  };
}
