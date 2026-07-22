import { NextRequest, NextResponse } from 'next/server.js';

import { listProviderEvents } from '../../../../../lib/server/admin-provider-config.ts';
import {
  parseEventQuery,
  ProviderConfigInputError,
} from '../../../../../lib/server/provider-config-input.ts';
import {
  adminInvalid,
  adminProviderError,
  requireAdmin,
} from '../../_shared.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(
      await listProviderEvents(auth.pool, parseEventQuery(request.nextUrl.searchParams)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError ? adminInvalid() : adminProviderError(error);
  }
}
