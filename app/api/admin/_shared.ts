import { NextRequest, NextResponse } from 'next/server.js';

import { authenticateAdminSession } from '../../../lib/server/admin-auth.ts';
import { loadAdminConfig } from '../../../lib/server/config.ts';
import { getPool } from '../../../lib/server/db.ts';

export function adminUnauthorized() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_AUTH_REQUIRED' },
    { status: 401, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function adminForbidden() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_ORIGIN_REQUIRED' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function adminUnavailable() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_UNAVAILABLE' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function hasAdminOrigin(request: NextRequest, allowedOrigin: string): boolean {
  return request.headers.get('origin') === allowedOrigin;
}

export async function requireAdmin(request: NextRequest) {
  const config = loadAdminConfig();
  const token = request.cookies.get(config.cookieName)?.value ?? '';
  const pool = getPool(config.databaseUrl);
  const session = await authenticateAdminSession(pool, token, {
    sessionTtlMs: config.sessionMinutes * 60_000,
  });
  if (!session) return { ok: false as const, response: adminUnauthorized() };
  return { ok: true as const, config, pool, session, token };
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/api/admin',
  };
}

export function expiredAdminCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/api/admin',
    maxAge: 0,
  };
}
