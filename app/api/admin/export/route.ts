import { NextRequest, NextResponse } from 'next/server.js';

import { reauthenticateAdminPassword } from '../../../../lib/server/admin-auth.ts';
import {
  streamAdminExport,
  type AdminExportFormat,
  type AdminExportInput,
} from '../../../../lib/server/admin-export.ts';
import {
  getAdminTurn,
  listAdminTurns,
  normalizeAdminTurnFilters,
  type AdminTurnFilterInput,
  type NormalizedAdminTurnFilters,
} from '../../../../lib/server/admin-query.ts';

import {
  adminForbidden,
  adminUnavailable,
  hasAdminOrigin,
  requireAdmin,
} from '../_shared.ts';

export const runtime = 'nodejs';

function exportRecord(turn: NonNullable<Awaited<ReturnType<typeof getAdminTurn>>>): AdminExportInput {
  return {
    ...turn,
    sources: turn.knowledgeSources,
    searchQuery: turn.search?.query ?? null,
    diagnosis: turn.diagnosis
      ? {
          id: turn.diagnosis.id,
          ...turn.diagnosis.fields,
          summary: turn.diagnosis.summary,
          status: turn.diagnosis.status,
          notificationStatus: turn.diagnosis.notificationStatus,
          completedAt: turn.diagnosis.completedAt,
        }
      : null,
  };
}

async function* exportRecords(input: {
  pool: Parameters<typeof listAdminTurns>[0];
  filters: NormalizedAdminTurnFilters;
  now: Date;
}): AsyncIterable<AdminExportInput> {
  let page = 1;
  while (true) {
    const result = await listAdminTurns(input.pool, {
      ...input.filters,
      now: input.now,
      page,
      limit: 100,
    });
    for (const item of result.items) {
      const detail = await getAdminTurn(input.pool, item.id, input.now);
      if (detail) yield exportRecord(detail);
    }
    if (page * result.limit >= result.total) return;
    page += 1;
  }
}

function readableExport(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth.ok) return auth.response;
    if (!hasAdminOrigin(request, auth.config.allowedOrigin)) return adminForbidden();
    const body = await request.json() as Record<string, unknown>;
    const format = body.format === 'json' || body.format === 'csv'
      ? body.format as AdminExportFormat
      : null;
    const password = typeof body.password === 'string' ? body.password : '';
    const filterInput = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? body.filters as AdminTurnFilterInput
      : {};
    if (!format || !password || password.length > 512) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_EXPORT_REQUEST' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const filters = normalizeAdminTurnFilters(filterInput);
    const verified = await reauthenticateAdminPassword(auth.pool, password, {
      passwordHash: auth.config.passwordHash,
      policy: {
        maxFailedAttempts: auth.config.maxFailedAttempts,
        lockoutMs: auth.config.lockMinutes * 60_000,
      },
    });
    if (!verified) {
      return NextResponse.json(
        { ok: false, error: 'ADMIN_REAUTH_FAILED' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const now = new Date();
    const bytes = streamAdminExport(format, exportRecords({ pool: auth.pool, filters, now }));
    const extension = format === 'csv' ? 'csv' : 'json';
    const date = now.toISOString().slice(0, 10);
    return new Response(readableExport(bytes), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="morse-interactions-${date}.${extension}"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && /^Invalid /u.test(error.message)) {
      return NextResponse.json(
        { ok: false, error: 'INVALID_EXPORT_REQUEST' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return adminUnavailable();
  }
}
