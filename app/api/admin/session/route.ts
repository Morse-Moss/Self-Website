import { NextRequest, NextResponse } from 'next/server.js';

import {
  authenticateAdmin,
  revokeAdminSession,
} from '../../../../lib/server/admin-auth.ts';
import { loadAdminConfig } from '../../../../lib/server/config.ts';
import { getPool } from '../../../../lib/server/db.ts';

import {
  adminCookieOptions,
  adminForbidden,
  adminUnavailable,
  expiredAdminCookieOptions,
  hasAdminOrigin,
  requireAdmin,
} from '../_shared.ts';

export const runtime = 'nodejs';

function loginFailed() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_AUTH_FAILED' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest) {
  try {
    const config = loadAdminConfig();
    if (!hasAdminOrigin(request, config.allowedOrigin)) return adminForbidden();
    const body = await request.json() as Record<string, unknown>;
    const password = typeof body.password === 'string' ? body.password : '';
    const totpCode = typeof body.totpCode === 'string' ? body.totpCode : '';
    if (!password || password.length > 512 || !/^\d{6}$/u.test(totpCode)) return loginFailed();

    const result = await authenticateAdmin(
      getPool(config.databaseUrl),
      { password, totpCode },
      {
        passwordHash: config.passwordHash,
        totpSecret: config.totpSecret,
        policy: {
          maxFailedAttempts: config.maxFailedAttempts,
          lockoutMs: config.lockMinutes * 60_000,
          sessionTtlMs: config.sessionMinutes * 60_000,
          totpWindow: 1,
        },
      },
    );
    if (!result.ok) return loginFailed();

    const response = NextResponse.json(
      { ok: true, expiresAt: result.expiresAt.toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    response.cookies.set(config.cookieName, result.token, adminCookieOptions());
    return response;
  } catch {
    return adminUnavailable();
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(
      { authorized: true, expiresAt: auth.session.expiresAt.toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return adminUnavailable();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const config = loadAdminConfig();
    if (!hasAdminOrigin(request, config.allowedOrigin)) return adminForbidden();
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    await revokeAdminSession(getPool(config.databaseUrl), token);
    const response = NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    response.cookies.set(config.cookieName, '', expiredAdminCookieOptions());
    return response;
  } catch {
    return adminUnavailable();
  }
}
