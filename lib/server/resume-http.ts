import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { NextRequest, NextResponse } from 'next/server.js';

import { trustedInviteSource } from './access.ts';
import type {
  AuthenticatedResumeSession,
  ResumeRedeemPolicy,
  ResumeRequestContext,
} from './resume-access.ts';
import type { EnabledResumeConfig } from './resume-config.ts';

export const RESUME_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
} as const;

export interface ResumeAccessPayload {
  enabled: boolean;
  authorized: boolean;
  documentAvailable: boolean;
  expiresAt: string | null;
}

export function resumeCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    expires: expiresAt,
  };
}

export function expiredResumeCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  };
}

export function hasResumeOrigin(request: NextRequest, allowedOrigin: string): boolean {
  return request.headers.get('origin') === allowedOrigin;
}

export function hashResumeSourceFingerprint(secret: string, source: string): string {
  return createHmac('sha256', secret).update(source, 'utf8').digest('hex');
}

export function resumeRequestContext(
  request: NextRequest,
  config: EnabledResumeConfig,
): ResumeRequestContext {
  const source = trustedInviteSource(
    request.headers.get('x-forwarded-for'),
    config.trustedProxyHops,
  );
  const ip = isIP(source) ? source : '0.0.0.0';
  return {
    ip,
    userAgent: request.headers.get('user-agent')?.slice(0, 1_024) || 'unattributed',
    deviceInfo: {
      brand: request.headers.get('sec-ch-ua')?.slice(0, 512) ?? '',
      mobile: request.headers.get('sec-ch-ua-mobile')?.slice(0, 16) ?? '',
      platform: request.headers.get('sec-ch-ua-platform')?.slice(0, 128) ?? '',
    },
    fingerprintHash: hashResumeSourceFingerprint(config.fingerprintSecret, source),
  };
}

export function resumeRedeemPolicy(config: EnabledResumeConfig): ResumeRedeemPolicy {
  return {
    sessionHours: config.sessionHours,
    attemptWindowSeconds: 10 * 60,
    maxFailedAttempts: 5,
    lockSeconds: 15 * 60,
    auditRetentionDays: config.auditRetentionDays,
  };
}

export function disabledResumeState(): ResumeAccessPayload {
  return {
    enabled: false,
    authorized: false,
    documentAvailable: false,
    expiresAt: null,
  };
}

export function unauthorizedResumeState(documentAvailable: boolean): ResumeAccessPayload {
  return {
    enabled: true,
    authorized: false,
    documentAvailable,
    expiresAt: null,
  };
}

export function authorizedResumeState(
  session: AuthenticatedResumeSession,
  documentAvailable: boolean,
): ResumeAccessPayload {
  return {
    enabled: true,
    authorized: true,
    documentAvailable,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function resumeAccessResponse(payload: ResumeAccessPayload, status = 200) {
  return NextResponse.json(payload, { status, headers: RESUME_NO_STORE_HEADERS });
}

export function resumeForbidden() {
  return NextResponse.json(
    { ok: false, error: 'RESUME_ORIGIN_REQUIRED' },
    { status: 403, headers: RESUME_NO_STORE_HEADERS },
  );
}

export function resumeUnauthorized() {
  return NextResponse.json(
    { ok: false, error: 'RESUME_AUTH_REQUIRED' },
    { status: 401, headers: RESUME_NO_STORE_HEADERS },
  );
}

export function resumeNotAvailable() {
  return NextResponse.json(
    { ok: false, error: 'RESUME_NOT_AVAILABLE' },
    { status: 404, headers: RESUME_NO_STORE_HEADERS },
  );
}

export function resumeUnavailable() {
  return NextResponse.json(
    { ok: false, error: 'RESUME_UNAVAILABLE' },
    { status: 503, headers: RESUME_NO_STORE_HEADERS },
  );
}
