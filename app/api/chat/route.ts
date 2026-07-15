import { NextRequest } from 'next/server';

import { authenticateSession } from '@/lib/server/access';
import { normalizeChatRequest } from '@/lib/server/chat-core';
import {
  ChatServiceError,
  runChat,
  type ChatServiceEvent,
} from '@/lib/server/chat-service';
import { loadServerConfig } from '@/lib/server/config';
import { getPool } from '@/lib/server/db';
import { createProvider } from '@/lib/server/provider';
import {
  createSseStream,
  type SseScheduler,
} from '@/lib/server/sse';

export const runtime = 'nodejs';

function jsonError(error: string, status: number) {
  return Response.json({ ok: false, error }, { status });
}

function publicErrorCode(error: unknown): string {
  return error instanceof ChatServiceError ? error.code : 'CHAT_UNAVAILABLE';
}

export interface ChatRouteStreamInput {
  requestSignal: AbortSignal;
  heartbeatMs: number;
  runChat(signal: AbortSignal): AsyncIterable<ChatServiceEvent>;
  abortController?: AbortController;
  scheduler?: SseScheduler;
}

export function createChatRouteStream(input: ChatRouteStreamInput): ReadableStream<Uint8Array> {
  const abortController = input.abortController ?? new AbortController();
  return createSseStream({
    abortController,
    parentSignal: input.requestSignal,
    heartbeatMs: input.heartbeatMs,
    scheduler: input.scheduler,
    async run(signal, emit) {
      try {
        for await (const event of input.runChat(signal)) {
          if (!emit(event.type, event)) return;
        }
      } catch (error) {
        if (!signal.aborted) emit('error', { code: publicErrorCode(error) });
      }
    },
  });
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

  const stream = createChatRouteStream({
    requestSignal: request.signal,
    heartbeatMs: config.sseHeartbeatMs,
    runChat: (signal) => runChat({
      pool,
      provider: createProvider(config),
      accessSessionId: session.id,
      request: chatRequest,
      config: {
        maxMessagesPerSession: config.maxMessagesPerSession,
        historyMessageLimit: config.historyMessageLimit,
        retrievalLimit: config.retrievalLimit,
        interactionRetentionDays: config.interactionRetentionDays,
        tokenRates: config.tokenRates,
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
