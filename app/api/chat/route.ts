import { NextRequest } from 'next/server';

import { authenticateSession } from '@/lib/server/access';
import { normalizeChatRequest } from '@/lib/server/chat-core';
import { createChatRouteStream } from '@/lib/server/chat-route-stream';
import { runChat } from '@/lib/server/chat-service';
import { loadServerConfig } from '@/lib/server/config';
import { getPool } from '@/lib/server/db';
import { createSearchProvider } from '@/lib/server/provider';
import { resolveProviderRuntime } from '@/lib/server/provider-runtime';

export const runtime = 'nodejs';

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  let config: ReturnType<typeof loadServerConfig>;
  let chatRequest: ReturnType<typeof normalizeChatRequest>;

  try {
    config = loadServerConfig();
  } catch {
    return jsonError('CHAT_NOT_CONFIGURED', 503);
  }
  if (!config.chatEnabled) return jsonError('CHAT_DISABLED', 503);

  try {
    chatRequest = normalizeChatRequest(await request.json());
  } catch {
    return jsonError('INVALID_CHAT_REQUEST', 400);
  }

  const pool = getPool(config.databaseUrl);
  const token = request.cookies.get(config.cookieName)?.value ?? '';
  const session = await authenticateSession(pool, token);
  if (!session) return jsonError('ACCESS_REQUIRED', 401);

  let providerRuntime: Awaited<ReturnType<typeof resolveProviderRuntime>>;
  try {
    providerRuntime = await resolveProviderRuntime(pool, config);
  } catch {
    return jsonError('CHAT_NOT_CONFIGURED', 503);
  }

  const stream = createChatRouteStream({
    requestSignal: request.signal,
    heartbeatMs: config.sseHeartbeatMs,
    runChat: (signal) => runChat({
      pool,
      provider: providerRuntime.provider,
      searchProvider: createSearchProvider(config),
      accessSessionId: session.id,
      request: chatRequest,
      config: {
        maxMessagesPerSession: config.maxMessagesPerSession,
        historyMessageLimit: config.historyMessageLimit,
        retrievalLimit: config.retrievalLimit,
        interactionRetentionDays: config.interactionRetentionDays,
        tokenRates: config.tokenRates,
        searchEnabled: config.searchEnabled,
        maxSearchesPerSession: config.maxSearchesPerSession,
        providerName: 'openai',
        model: config.chatModel,
      },
      signal,
    }),
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
