import { NextRequest, NextResponse } from 'next/server.js';

import { getAdminTurn, updateAdminBadcase } from '../../../../../lib/server/admin-query.ts';

import {
  adminForbidden,
  adminUnavailable,
  hasAdminOrigin,
  requireAdmin,
} from '../../_shared.ts';

export const runtime = 'nodejs';

interface TurnRouteContext {
  params: Promise<{ turnId: string }>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function notFound() {
  return NextResponse.json(
    { ok: false, error: 'ADMIN_TURN_NOT_FOUND' },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest, context: TurnRouteContext) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const { turnId } = await context.params;
    if (!isUuid(turnId)) return notFound();
    const turn = await getAdminTurn(auth.pool, turnId);
    return turn
      ? NextResponse.json(turn, { headers: { 'Cache-Control': 'no-store' } })
      : notFound();
  } catch {
    return adminUnavailable();
  }
}

export async function PATCH(request: NextRequest, context: TurnRouteContext) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { turnId } = await context.params;
    if (!isUuid(turnId)) return notFound();
    const body = await request.json() as Record<string, unknown>;
    if (
      typeof body.badcase !== 'boolean'
      || (body.note !== null && body.note !== undefined && typeof body.note !== 'string')
    ) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_BADCASE_UPDATE' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const turn = await updateAdminBadcase({
      pool: auth.pool,
      turnId,
      badcase: body.badcase,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return turn
      ? NextResponse.json(
          { badcase: turn.badcase, adminNote: turn.adminNote },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      : notFound();
  } catch (error) {
    if (error instanceof Error && /2,000/u.test(error.message)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_BADCASE_UPDATE' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return adminUnavailable();
  }
}
