import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { hashSecret } from './security.ts';

const INVITE_RANDOM_BYTES = 24;
const MAX_LABEL_LENGTH = 80;
const MIN_DURATION_HOURS = 1;
const MAX_DURATION_HOURS = 720;
const MIN_SESSIONS = 1;
const MAX_SESSIONS = 100;

export type AdminInviteStatus = 'active' | 'expired' | 'exhausted' | 'inactive';

export interface AdminInvite {
  id: string;
  label: string;
  active: boolean;
  expiresAt: string;
  maxSessions: number;
  sessionCount: number;
  createdAt: string;
  status: AdminInviteStatus;
}

export interface AdminInviteCreationInput {
  label: unknown;
  durationHours: unknown;
  maxSessions: unknown;
}

export interface NormalizedAdminInviteCreationInput {
  label: string;
  durationHours: number;
  maxSessions: number;
}

export interface CreateAdminInviteOptions {
  now?: Date;
}

interface InviteRow {
  id: string;
  label: string;
  active: boolean;
  expires_at: Date;
  max_sessions: number;
  session_count: number;
  created_at: Date;
}

export class AdminInviteInputError extends Error {
  constructor() {
    super('INVALID_ADMIN_INVITE');
    this.name = 'AdminInviteInputError';
  }
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new AdminInviteInputError();
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new AdminInviteInputError();
  }
  return value as number;
}

export function normalizeAdminInviteCreationInput(
  input: AdminInviteCreationInput,
): NormalizedAdminInviteCreationInput {
  if (typeof input.label !== 'string') throw new AdminInviteInputError();
  const label = input.label.trim();
  if (!label || label.length > MAX_LABEL_LENGTH) throw new AdminInviteInputError();
  return {
    label,
    durationHours: boundedInteger(input.durationHours, MIN_DURATION_HOURS, MAX_DURATION_HOURS),
    maxSessions: boundedInteger(input.maxSessions, MIN_SESSIONS, MAX_SESSIONS),
  };
}

function statusForInvite(row: InviteRow, now: Date): AdminInviteStatus {
  if (!row.active) return 'inactive';
  if (row.expires_at.getTime() <= now.getTime()) return 'expired';
  if (row.session_count >= row.max_sessions) return 'exhausted';
  return 'active';
}

function adminInvite(row: InviteRow, now: Date): AdminInvite {
  return {
    id: row.id,
    label: row.label,
    active: row.active,
    expiresAt: row.expires_at.toISOString(),
    maxSessions: row.max_sessions,
    sessionCount: row.session_count,
    createdAt: row.created_at.toISOString(),
    status: statusForInvite(row, now),
  };
}

const INVITE_FIELDS = `id, label, active, expires_at, max_sessions, session_count, created_at`;

export async function listAdminInvites(
  pool: Pool,
  now = new Date(),
): Promise<AdminInvite[]> {
  const effectiveNow = validDate(now);
  const result = await pool.query<InviteRow>(
    `SELECT ${INVITE_FIELDS}
       FROM invite_codes
      ORDER BY created_at DESC, id DESC`,
  );
  return result.rows.map((row) => adminInvite(row, effectiveNow));
}

export async function createAdminInvite(
  pool: Pool,
  input: AdminInviteCreationInput,
  options: CreateAdminInviteOptions = {},
): Promise<{ invite: AdminInvite; code: string }> {
  const normalized = normalizeAdminInviteCreationInput(input);
  const now = validDate(options.now ?? new Date());
  const expiresAt = new Date(now.getTime() + normalized.durationHours * 60 * 60_000);
  const code = `morse_${randomBytes(INVITE_RANDOM_BYTES).toString('base64url')}`;
  const result = await pool.query<InviteRow>(
    `INSERT INTO invite_codes
      (id, code_hash, label, active, expires_at, max_sessions, session_count, created_at)
     VALUES ($1, $2, $3, true, $4, $5, 0, $6)
     RETURNING ${INVITE_FIELDS}`,
    [randomUUID(), hashSecret(code), normalized.label, expiresAt, normalized.maxSessions, now],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Admin invite was not created.');
  return { invite: adminInvite(row, now), code };
}

export async function deactivateAdminInvite(
  pool: Pool,
  inviteId: string,
  now = new Date(),
): Promise<AdminInvite | null> {
  const effectiveNow = validDate(now);
  const result = await pool.query<InviteRow>(
    `UPDATE invite_codes
        SET active = false
      WHERE id = $1
      RETURNING ${INVITE_FIELDS}`,
    [inviteId],
  );
  const row = result.rows[0];
  return row ? adminInvite(row, effectiveNow) : null;
}
