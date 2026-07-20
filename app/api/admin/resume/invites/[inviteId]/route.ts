import { NextRequest, NextResponse } from 'next/server.js';
import { reauthenticateAdminPassword } from '../../../../../../lib/server/admin-auth.ts';
import { disableResumeInvite } from '../../../../../../lib/server/resume-access.ts';
import { adminForbidden, adminUnavailable, hasAdminOrigin, requireAdmin } from '../../../_shared.ts';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
export async function DELETE(request: NextRequest, context: { params: Promise<{ inviteId: string }> }) {
  try {
    const auth = await requireAdmin(request); if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const body = await request.json() as Record<string, unknown>; const password = typeof body.password === 'string' ? body.password : '';
    if (!password) return NextResponse.json({ ok: false, error: 'INVALID_RESUME_INVITE' }, { status: 400, headers });
    if (!await reauthenticateAdminPassword(auth.pool, password, { passwordHash: auth.config.passwordHash, policy: { maxFailedAttempts: auth.config.maxFailedAttempts, lockoutMs: auth.config.lockMinutes * 60_000 } })) return NextResponse.json({ ok: false, error: 'ADMIN_REAUTH_FAILED' }, { status: 401, headers });
    const { inviteId } = await context.params;
    return await disableResumeInvite(auth.pool, inviteId, auth.session.id)
      ? NextResponse.json({ ok: true }, { headers })
      : NextResponse.json({ ok: false, error: 'RESUME_INVITE_NOT_FOUND' }, { status: 404, headers });
  } catch { return adminUnavailable(); }
}
