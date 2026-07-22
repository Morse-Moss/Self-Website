import { NextRequest, NextResponse } from 'next/server.js';

import { authenticateAdminSession } from '../../../lib/server/admin-auth.ts';
import { reauthenticateAdminPassword } from '../../../lib/server/admin-auth.ts';
import { AiConfigError, loadAiConfigKey } from '../../../lib/server/ai-config.ts';
import {
  createAdminProviderTransport,
  type AdminProviderServiceOptions,
} from '../../../lib/server/admin-provider-config.ts';
import { loadAdminConfig, loadServerConfig } from '../../../lib/server/config.ts';
import { getPool } from '../../../lib/server/db.ts';
import { createProviderOutboundPolicy } from '../../../lib/server/provider-outbound.ts';

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

export function adminInvalid(error = 'AI_CONFIG_INVALID', status = 400) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function adminProviderError(error: unknown) {
  if (!(error instanceof AiConfigError)) return adminUnavailable();
  if (error.code === 'AI_CONFIG_NOT_FOUND') return adminInvalid('AI_CONFIG_INVALID', 404);
  const status = error.code === 'AI_CONFIG_CONFLICT' || error.code === 'AI_CONFIG_IN_USE'
    || error.code === 'AI_CONFIG_TEST_REQUIRED' || error.code === 'AI_CONFIG_HISTORY_RETAINED'
    || error.code === 'AI_CONFIG_TARGET_DELETED'
    ? 409
    : error.code === 'AI_CONFIG_RATE_LIMITED'
      ? 429
      : error.code === 'AI_CONFIG_UNAVAILABLE' || error.code === 'AI_CONFIG_SECRET_UNAVAILABLE'
          || error.code.startsWith('AI_CONFIG_KEY_')
        ? 503
        : 400;
  return adminInvalid(error.code.startsWith('AI_CONFIG_KEY_') ? 'AI_CONFIG_UNAVAILABLE' : error.code, status);
}

export function hasAdminOrigin(request: NextRequest, allowedOrigin: string): boolean {
  return request.headers.get('origin') === allowedOrigin;
}

export function isAdminProviderId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
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

export async function reauthenticateAdmin(
  auth: Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>,
  password: string,
) {
  const verified = await reauthenticateAdminPassword(auth.pool, password, {
    passwordHash: auth.config.passwordHash,
    policy: {
      maxFailedAttempts: auth.config.maxFailedAttempts,
      lockoutMs: auth.config.lockMinutes * 60_000,
    },
  });
  return verified
    ? null
    : NextResponse.json(
        { ok: false, error: 'ADMIN_REAUTH_FAILED' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
}

export function adminProviderServiceOptions(
  auth: Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>,
): AdminProviderServiceOptions {
  const runtimeConfig = loadServerConfig();
  const outboundPolicy = createProviderOutboundPolicy();
  return {
    actorAdminSessionId: auth.session.id,
    configKey: loadAiConfigKey(),
    outboundPolicy,
    runtimeConfig,
    transport: createAdminProviderTransport(runtimeConfig, { policy: outboundPolicy }),
  };
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
