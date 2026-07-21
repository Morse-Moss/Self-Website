import { NextRequest, NextResponse } from 'next/server.js';

import { createProviderModel } from '../../../../../../lib/server/admin-provider-config.ts';
import {
  parseModelMutationInput,
  ProviderConfigInputError,
} from '../../../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  isAdminProviderId,
  reauthenticateAdmin,
  requireAdmin,
} from '../../../_shared.ts';

export const runtime = 'nodejs';
interface Context { params: Promise<{ connectionId: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { connectionId } = await context.params;
    if (!isAdminProviderId(connectionId)) return adminInvalid();
    const input = parseModelMutationInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await createProviderModel(auth.pool, connectionId, input.model, adminProviderServiceOptions(auth)),
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
