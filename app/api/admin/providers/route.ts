import { NextRequest, NextResponse } from 'next/server.js';

import {
  createProviderConnection,
  getProviderCatalog,
} from '../../../../lib/server/admin-provider-config.ts';
import {
  parseCatalogQuery,
  parseConnectionCreateInput,
  ProviderConfigInputError,
} from '../../../../lib/server/provider-config-input.ts';
import {
  adminForbidden,
  adminInvalid,
  adminProviderError,
  adminProviderServiceOptions,
  hasAdminOrigin,
  reauthenticateAdmin,
  requireAdmin,
} from '../_shared.ts';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    const query = parseCatalogQuery(request.nextUrl.searchParams);
    return NextResponse.json(await getProviderCatalog(auth.pool, query), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return error instanceof ProviderConfigInputError ? adminInvalid() : adminProviderError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const input = parseConnectionCreateInput(await request.json());
    const rejected = await reauthenticateAdmin(auth, input.password);
    if (rejected) return rejected;
    const created = await createProviderConnection(auth.pool, {
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      firstModel: input.firstModel,
      name: input.name,
      userAgent: input.userAgent,
    }, adminProviderServiceOptions(auth));
    return NextResponse.json(created, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return error instanceof ProviderConfigInputError || error instanceof SyntaxError
      ? adminInvalid()
      : adminProviderError(error);
  }
}
