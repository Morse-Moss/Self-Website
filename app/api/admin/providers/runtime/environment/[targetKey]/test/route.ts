import { NextRequest, NextResponse } from 'next/server.js';

import { testEnvironmentProviderTarget } from '../../../../../../../../lib/server/admin-provider-config.ts';
import {
  parsePasswordInput,
  ProviderConfigInputError,
} from '../../../../../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  reauthenticateAdmin,
  requireAdmin,
} from '../../../../../_shared.ts';

export const runtime = 'nodejs';
interface Context { params: Promise<{ targetKey: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { targetKey } = await context.params;
    if (!['primary', 'fallback-1', 'fallback-2'].includes(targetKey)) return adminInvalid();
    const input = parsePasswordInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await testEnvironmentProviderTarget(
        auth.pool,
        targetKey as 'primary' | 'fallback-1' | 'fallback-2',
        adminProviderServiceOptions(auth),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
