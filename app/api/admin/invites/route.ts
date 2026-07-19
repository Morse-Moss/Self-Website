import { NextRequest, NextResponse } from 'next/server.js';

import { consumeAdminTotp } from '../../../../lib/server/admin-auth.ts';
import {
  AdminInviteInputError,
  createAdminInvite,
  listAdminInvites,
  normalizeAdminInviteCreationInput,
} from '../../../../lib/server/admin-invites.ts';

import {
  adminForbidden,
  adminUnavailable,
  hasAdminOrigin,
  requireAdmin,
} from '../_shared.ts';

export const runtime = 'nodejs';

function invalidInvite() {
  return NextResponse.json(
    { ok: false, error: 'INVALID_ADMIN_INVITE' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const items = await listAdminInvites(auth.pool);
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return adminUnavailable();
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();

    const rawBody = await request.json() as unknown;
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) return invalidInvite();
    const body = rawBody as Record<string, unknown>;
    const input = normalizeAdminInviteCreationInput({
      label: body.label,
      durationHours: body.durationHours,
      maxSessions: body.maxSessions,
    });
    const totpCode = typeof body.totpCode === 'string' ? body.totpCode : '';
    if (!/^\d{6}$/u.test(totpCode)) return invalidInvite();

    const verified = await consumeAdminTotp(
      auth.pool,
      { totpCode },
      {
        totpSecret: auth.config.totpSecret,
        policy: {
          maxFailedAttempts: auth.config.maxFailedAttempts,
          lockoutMs: auth.config.lockMinutes * 60_000,
          window: 1,
        },
      },
    );
    if (!verified) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_TOTP_REQUIRED' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const created = await createAdminInvite(auth.pool, input);
    return NextResponse.json(created, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof AdminInviteInputError || error instanceof SyntaxError) return invalidInvite();
    return adminUnavailable();
  }
}
