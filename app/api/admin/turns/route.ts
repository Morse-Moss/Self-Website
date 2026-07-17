import { NextRequest, NextResponse } from 'next/server.js';

import { listAdminTurns } from '../../../../lib/server/admin-query.ts';

import { adminUnavailable, requireAdmin } from '../_shared.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const search = request.nextUrl.searchParams;
    const result = await listAdminTurns(auth.pool, {
      workflow: search.get('workflow'),
      status: search.get('status'),
      usedSearch: search.get('usedSearch'),
      badcase: search.get('badcase'),
      from: search.get('from'),
      to: search.get('to'),
      page: search.get('page'),
      limit: search.get('limit'),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && /^Invalid /u.test(error.message)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_ADMIN_FILTER' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return adminUnavailable();
  }
}
