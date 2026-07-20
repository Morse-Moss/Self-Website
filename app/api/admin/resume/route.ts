import { NextRequest, NextResponse } from 'next/server.js';
import { reauthenticateAdminPassword } from '../../../../lib/server/admin-auth.ts';
import { getAdminResumeDashboard, replaceCurrentResume, ResumeAdminInputError } from '../../../../lib/server/resume-admin.ts';
import { loadResumeConfig } from '../../../../lib/server/resume-config.ts';
import { adminForbidden, adminUnavailable, hasAdminOrigin, requireAdmin } from '../_shared.ts';

export const runtime = 'nodejs';
const HEADERS = { 'Cache-Control': 'no-store' };
const invalid = () => NextResponse.json({ ok: false, error: 'INVALID_RESUME_PDF' }, { status: 400, headers: HEADERS });

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(await getAdminResumeDashboard(auth.pool), { headers: HEADERS });
  } catch { return adminUnavailable(); }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const length = request.headers.get('content-length');
    if (length && /^\d+$/u.test(length) && Number(length) > 11_000_000) {
      return NextResponse.json({ ok: false, error: 'RESUME_UPLOAD_TOO_LARGE' }, { status: 413, headers: HEADERS });
    }
    const form = await request.formData();
    const password = form.get('password');
    const file = form.get('file');
    if (typeof password !== 'string' || !password || password.length > 512 || !(file instanceof File)) return invalid();
    const verified = await reauthenticateAdminPassword(auth.pool, password, {
      passwordHash: auth.config.passwordHash,
      policy: { maxFailedAttempts: auth.config.maxFailedAttempts, lockoutMs: auth.config.lockMinutes * 60_000 },
    });
    if (!verified) return NextResponse.json({ ok: false, error: 'ADMIN_REAUTH_FAILED' }, { status: 401, headers: HEADERS });
    const config = loadResumeConfig();
    if (!config.enabled) return adminUnavailable();
    const document = await replaceCurrentResume({
      pool: auth.pool, adminSessionId: auth.session.id, fileName: file.name, mimeType: file.type,
      pdf: Buffer.from(await file.arrayBuffer()), maxPdfBytes: config.maxPdfBytes,
      storageDir: config.storageDir, key: config.encryptionKey, keyVersion: config.keyVersion,
      auditRetentionDays: config.auditRetentionDays,
    });
    return NextResponse.json({ ok: true, document }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof ResumeAdminInputError) return invalid();
    return adminUnavailable();
  }
}
