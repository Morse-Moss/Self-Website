import { NextRequest, NextResponse } from 'next/server.js';

import { getProviderRuntimeSummary } from '../../../../../lib/server/admin-provider-config.ts';
import {
  adminProviderError,
  adminProviderServiceOptions,
  requireAdmin,
} from '../../_shared.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(
      await getProviderRuntimeSummary(auth.pool, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return adminProviderError(error);
  }
}
