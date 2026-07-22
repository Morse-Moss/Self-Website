import { NextRequest, NextResponse } from 'next/server.js';

import { testProviderModel } from '../../../../../../../lib/server/admin-provider-config.ts';
import {
  parsePasswordInput,
  ProviderConfigInputError,
} from '../../../../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  isAdminProviderId,
  reauthenticateAdmin,
  requireAdmin,
} from '../../../../_shared.ts';

export const runtime = 'nodejs';
interface Context { params: Promise<{ modelId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { modelId } = await context.params;
    if (!isAdminProviderId(modelId)) return adminInvalid();
    const input = parsePasswordInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await testProviderModel(auth.pool, modelId, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
