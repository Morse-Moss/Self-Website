import { NextRequest, NextResponse } from 'next/server';

import { AccessError, authenticateSession, redeemInvite } from '@/lib/server/access';
import { loadAccessConfig } from '@/lib/server/config';
import { getPool } from '@/lib/server/db';
import { hashSecret } from '@/lib/server/security';

export const runtime = 'nodejs';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'INVALID_OR_EXPIRED_CODE' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 128) return unauthorized();

    const config = loadAccessConfig();
    const session = await redeemInvite(getPool(config.databaseUrl), code, {
      sessionHours: config.sessionHours,
    });
    const response = NextResponse.json({
      ok: true,
      expiresAt: session.expiresAt.toISOString(),
      remainingMessages: config.maxMessagesPerSession,
    });
    response.cookies.set(config.cookieName, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    if (error instanceof AccessError) return unauthorized();
    return NextResponse.json({ ok: false, error: 'ACCESS_UNAVAILABLE' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const config = loadAccessConfig();
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    const session = await authenticateSession(getPool(config.databaseUrl), token);
    return NextResponse.json({
      authorized: Boolean(session),
      expiresAt: session?.expiresAt.toISOString() ?? null,
      remainingMessages: session
        ? Math.max(0, config.maxMessagesPerSession - session.messageCount)
        : 0,
    });
  } catch {
    return NextResponse.json({ authorized: false, expiresAt: null, remainingMessages: 0 });
  }
}

export async function DELETE(request: NextRequest) {
  const config = loadAccessConfig();
  const token = request.cookies.get(config.cookieName)?.value ?? '';
  if (token) {
    await getPool(config.databaseUrl).query(
      'DELETE FROM access_sessions WHERE token_hash = $1',
      [hashSecret(token)],
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(config.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
