import { NextRequest, NextResponse } from 'next/server.js';

import {
  ResumeAccessError,
  authenticateResumeSession,
  redeemResumeInviteProtected,
  revokeResumeSession,
} from '../../../../lib/server/resume-access.ts';
import { loadResumeConfig } from '../../../../lib/server/resume-config.ts';
import { getPool } from '../../../../lib/server/db.ts';
import {
  RESUME_NO_STORE_HEADERS,
  authorizedResumeState,
  disabledResumeState,
  expiredResumeCookieOptions,
  hasResumeOrigin,
  resumeAccessResponse,
  resumeCookieOptions,
  resumeForbidden,
  resumeRedeemPolicy,
  resumeRequestContext,
  unauthorizedResumeState,
} from '../../../../lib/server/resume-http.ts';
import { getCurrentResumeDocument } from '../../../../lib/server/resume-storage.ts';

export const runtime = 'nodejs';

function unavailableAccessState(status = 503) {
  return resumeAccessResponse(disabledResumeState(), status);
}

export async function GET(request: NextRequest) {
  try {
    const config = loadResumeConfig();
    if (!config.enabled) return resumeAccessResponse(disabledResumeState());
    const pool = getPool(config.databaseUrl);
    const documentAvailable = Boolean(await getCurrentResumeDocument(pool));
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    const session = await authenticateResumeSession(pool, token);
    return session
      ? resumeAccessResponse(authorizedResumeState(session, documentAvailable))
      : resumeAccessResponse(unauthorizedResumeState(documentAvailable), 401);
  } catch {
    return unavailableAccessState();
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = loadResumeConfig();
    if (!config.enabled) return resumeAccessResponse(disabledResumeState(), 404);
    if (!hasResumeOrigin(request, config.publicOrigin)) return resumeForbidden();
    const pool = getPool(config.databaseUrl);
    const documentAvailable = Boolean(await getCurrentResumeDocument(pool));
    let body: Record<string, unknown>;
    try {
      const candidate = await request.json() as unknown;
      body = typeof candidate === 'object' && candidate !== null
        ? candidate as Record<string, unknown>
        : {};
    } catch {
      body = {};
    }
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code || code.length > 128) {
      return resumeAccessResponse(unauthorizedResumeState(documentAvailable), 401);
    }
    try {
      const session = await redeemResumeInviteProtected(
        pool,
        code,
        resumeRequestContext(request, config),
        resumeRedeemPolicy(config),
      );
      const response = resumeAccessResponse({
        enabled: true,
        authorized: true,
        documentAvailable,
        expiresAt: session.expiresAt.toISOString(),
      });
      response.cookies.set(config.cookieName, session.token, resumeCookieOptions(session.expiresAt));
      return response;
    } catch (error) {
      if (error instanceof ResumeAccessError) {
        return resumeAccessResponse(unauthorizedResumeState(documentAvailable), 401);
      }
      throw error;
    }
  } catch {
    return unavailableAccessState();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const config = loadResumeConfig();
    if (!config.enabled) return resumeAccessResponse(disabledResumeState(), 404);
    if (!hasResumeOrigin(request, config.publicOrigin)) return resumeForbidden();
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    await revokeResumeSession(
      getPool(config.databaseUrl),
      token,
      resumeRequestContext(request, config),
    );
    const response = NextResponse.json(
      { ok: true },
      { headers: RESUME_NO_STORE_HEADERS },
    );
    response.cookies.set(config.cookieName, '', expiredResumeCookieOptions());
    return response;
  } catch {
    return unavailableAccessState();
  }
}
