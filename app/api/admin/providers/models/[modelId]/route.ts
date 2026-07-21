import { NextRequest, NextResponse } from 'next/server.js';

import {
  deleteProviderModel,
  updateProviderModel,
} from '../../../../../../lib/server/admin-provider-config.ts';
import {
  parseDeleteInput,
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
interface Context { params: Promise<{ modelId: string }> }

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { modelId } = await context.params;
    if (!isAdminProviderId(modelId)) return adminInvalid();
    const input = parseModelMutationInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await updateProviderModel(auth.pool, modelId, input.model, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { modelId } = await context.params;
    if (!isAdminProviderId(modelId)) return adminInvalid();
    const input = parseDeleteInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await deleteProviderModel(auth.pool, modelId, input.confirmationName, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
