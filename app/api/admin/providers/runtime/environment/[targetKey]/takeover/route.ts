import { NextRequest, NextResponse } from 'next/server.js';

import { isEnvironmentTargetKey } from '../../../../../../../../lib/server/environment-provider-target.ts';
import { takeoverEnvironmentProvider } from '../../../../../../../../lib/server/environment-provider-takeover.ts';
import {
  parseEnvironmentTakeoverInput,
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
    if (!isEnvironmentTargetKey(targetKey)) return adminInvalid();
    const input = parseEnvironmentTakeoverInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    return NextResponse.json(
      await takeoverEnvironmentProvider(auth.pool, targetKey, {
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        expectedConfigDigest: input.expectedConfigDigest,
        firstModel: input.firstModel,
        name: input.name,
        requestId: input.requestId,
        reuseKeyAcrossOrigin: input.reuseKeyAcrossOrigin,
        userAgent: input.userAgent,
      }, adminProviderServiceOptions(auth)),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
