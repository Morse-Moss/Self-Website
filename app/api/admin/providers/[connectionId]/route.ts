import { NextRequest, NextResponse } from 'next/server.js';

import {
  deleteProviderConnection,
  updateProviderConnection,
} from '../../../../../lib/server/admin-provider-config.ts';
import {
  parseConnectionUpdateInput,
  parseDeleteInput,
  ProviderConfigInputError,
} from '../../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  isAdminProviderId,
  reauthenticateAdmin,
  requireAdmin,
} from '../../_shared.ts';

export const runtime = 'nodejs';
interface Context { params: Promise<{ connectionId: string }> }

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const { connectionId } = await context.params;
    if (!isAdminProviderId(connectionId)) return adminInvalid();
    const input = parseConnectionUpdateInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(await updateProviderConnection(auth.pool, connectionId, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      name: input.name,
      reuseKeyAcrossOrigin: input.reuseKeyAcrossOrigin,
      userAgent: input.userAgent,
    }, adminProviderServiceOptions(auth)), { headers: { 'Cache-Control': 'no-store' } });
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
    const { connectionId } = await context.params;
    if (!isAdminProviderId(connectionId)) return adminInvalid();
    const input = parseDeleteInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await deleteProviderConnection(
        auth.pool,
        connectionId,
        input.confirmationName,
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
