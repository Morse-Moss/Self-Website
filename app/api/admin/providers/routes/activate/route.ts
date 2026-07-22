import { NextRequest, NextResponse } from 'next/server.js';

import { activateProviderRoute } from '../../../../../../lib/server/admin-provider-config.ts';
import {
  parseActivateRouteInput,
  ProviderConfigInputError,
} from '../../../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  reauthenticateAdmin,
  requireAdmin,
} from '../../../_shared.ts';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const input = parseActivateRouteInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await activateProviderRoute(auth.pool, {
        expectedActiveRevision: input.expectedActiveRevision,
        rollbackToPrevious: input.rollbackToPrevious,
        targets: input.targets,
      }, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
