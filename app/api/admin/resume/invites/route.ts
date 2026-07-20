import { NextRequest, NextResponse } from 'next/server.js';
import { reauthenticateAdminPassword } from '../../../../../lib/server/admin-auth.ts';
import { createResumeInvite, getAdminResumeDashboard } from '../../../../../lib/server/resume-admin.ts';
import { loadResumeConfig } from '../../../../../lib/server/resume-config.ts';
import { adminForbidden, adminUnavailable, hasAdminOrigin, requireAdmin } from '../../_shared.ts';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: NextRequest) {
  try { const auth = await requireAdmin(request); if (!auth.ok) return auth.response; return NextResponse.json({ items: (await getAdminResumeDashboard(auth.pool)).invites }, { headers }); } catch { return adminUnavailable(); }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request); if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const body = await request.json() as Record<string, unknown>;
    const password = typeof body.password === 'string' ? body.password : '';
    const note = typeof body.trustedPersonNote === 'string' ? body.trustedPersonNote : '';
    if (!password || !note) return NextResponse.json({ ok: false, error: 'INVALID_RESUME_INVITE' }, { status: 400, headers });
    if (!await reauthenticateAdminPassword(auth.pool, password, { passwordHash: auth.config.passwordHash, policy: { maxFailedAttempts: auth.config.maxFailedAttempts, lockoutMs: auth.config.lockMinutes * 60_000 } })) {
      return NextResponse.json({ ok: false, error: 'ADMIN_REAUTH_FAILED' }, { status: 401, headers });
    }
    const config = loadResumeConfig(); if (!config.enabled) return adminUnavailable();
    const created = await createResumeInvite(auth.pool, { trustedPersonNote: note, adminSessionId: auth.session.id, auditRetentionDays: config.auditRetentionDays });
    return NextResponse.json({ ok: true, invite: { id: created.id, code: created.code, trustedPersonNote: created.trustedPersonNote, expiresAt: created.expiresAt.toISOString() } }, { status: 201, headers });
  } catch { return adminUnavailable(); }
}
