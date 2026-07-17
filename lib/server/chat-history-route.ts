import { NextRequest } from 'next/server';

import { authenticateSession } from '@/lib/server/access';
import { loadAccessConfig } from '@/lib/server/config';
import { loadConversationHistory } from '@/lib/server/conversation-history';
import { getPool } from '@/lib/server/db';

import type { Pool } from 'pg';

type AccessConfig = ReturnType<typeof loadAccessConfig>;

export interface HistoryRouteDependencies {
  pool?: Pool;
  config?: AccessConfig;
  now?: Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthorized() {
  return Response.json({ ok: false, error: 'ACCESS_REQUIRED' }, { status: 401 });
}

export async function getChatHistoryResponse(
  request: NextRequest,
  dependencies: HistoryRouteDependencies = {},
) {
  try {
    const config = dependencies.config ?? loadAccessConfig();
    const pool = dependencies.pool ?? getPool(config.databaseUrl);
    const now = dependencies.now ?? new Date();
    const token = request.cookies.get(config.cookieName)?.value ?? '';
    const session = await authenticateSession(pool, token, now);
    if (!session) return unauthorized();

    const rawConversationId = request.nextUrl.searchParams.get('conversationId')?.trim() || undefined;
    if (rawConversationId && !uuidPattern.test(rawConversationId)) return unauthorized();
    const history = await loadConversationHistory({
      pool,
      accessSessionId: session.id,
      conversationId: rawConversationId,
      now,
    });
    if (rawConversationId && !history) return unauthorized();

    return Response.json({
      ok: true,
      conversationId: history?.conversationId ?? null,
      workflow: history?.workflow ?? null,
      audienceIntent: history?.audienceIntent ?? null,
      messages: history?.messages ?? [],
      remainingMessages: Math.max(
        0,
        config.maxMessagesPerSession - session.messageCount,
      ),
    });
  } catch {
    return Response.json({ ok: false, error: 'HISTORY_UNAVAILABLE' }, { status: 503 });
  }
}
