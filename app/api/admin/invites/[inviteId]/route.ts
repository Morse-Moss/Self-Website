import { NextRequest, NextResponse } from 'next/server.js';

import { deactivateAdminInvite } from '../../../../../lib/server/admin-invites.ts';

import {
  adminForbidden,
  adminUnavailable,
  hasAdminOrigin,
  requireAdmin,
} from '../../_shared.ts';

export const runtime = 'nodejs';

interface InviteRouteContext {
  params: Promise<{ inviteId: string }>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_INVITE_NOT_FOUND' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

function invalidUpdate() {
  return NextResponse.json(
    { ok: false, error: 'INVALID_ADMIN_INVITE_UPDATE' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function PATCH(request: NextRequest, context: InviteRouteContext) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();

    const { inviteId } = await context.params;
    if (!isUuid(inviteId)) return notFound();
    const rawBody = await request.json() as unknown;
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) return invalidUpdate();
    const body = rawBody as Record<string, unknown>;
    if (body.active !== false || Object.keys(body).length !== 1) return invalidUpdate();

    const invite = await deactivateAdminInvite(auth.pool, inviteId);
    return invite
      ? NextResponse.json(invite, { headers: { 'Cache-Control': 'no-store' } })
      : notFound();
  } catch (error) {
    if (error instanceof SyntaxError) return invalidUpdate();
    return adminUnavailable();
  }
}
