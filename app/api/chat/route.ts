import { NextRequest } from 'next/server';

import { authenticateSession } from '@/lib/server/access';
import { normalizeChatRequest } from '@/lib/server/chat-core';
import { ChatServiceError, runChat } from '@/lib/server/chat-service';
import { loadServerConfig } from '@/lib/server/config';
import { getPool } from '@/lib/server/db';
import { createProvider } from '@/lib/server/provider';
import { encodeSse } from '@/lib/server/sse';

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

  try {
    chatRequest = normalizeChatRequest(await request.json());
  } catch {
    return jsonError('INVALID_CHAT_REQUEST', 400);
  }

  const pool = getPool(config.databaseUrl);
  const token = request.cookies.get(config.cookieName)?.value ?? '';
  const session = await authenticateSession(pool, token);
  if (!session) return jsonError('ACCESS_REQUIRED', 401);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runChat({
          pool,
          provider: createProvider(config),
          accessSessionId: session.id,
          request: chatRequest,
          config: {
            maxMessagesPerSession: config.maxMessagesPerSession,
            historyMessageLimit: config.historyMessageLimit,
            retrievalLimit: config.retrievalLimit,
            monthlyBudgetUsd: config.monthlyBudgetUsd,
            tokenRates: config.tokenRates,
            providerName: 'openai',
            model: config.chatModel,
          },
        })) {
          if (event.type === 'meta') {
            controller.enqueue(encoder.encode(encodeSse('meta', event)));
          } else if (event.type === 'delta') {
            controller.enqueue(encoder.encode(encodeSse('delta', event)));
          } else {
            controller.enqueue(encoder.encode(encodeSse('done', event)));
          }
        }
      } catch (error) {
        const code = error instanceof ChatServiceError ? error.code : 'CHAT_UNAVAILABLE';
        controller.enqueue(encoder.encode(encodeSse('error', { code })));
      } finally {
        controller.close();
      }
    },
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
