import {
  ChatServiceError,
  type ChatServiceEvent,
} from '@/lib/server/chat-service';
import {
  createSseStream,
  type SseScheduler,
} from '@/lib/server/sse';

export interface ChatRouteStreamInput {
  requestSignal: AbortSignal;
  heartbeatMs: number;
  runChat(signal: AbortSignal): AsyncIterable<ChatServiceEvent>;
  abortController?: AbortController;
  scheduler?: SseScheduler;
}

function publicErrorCode(error: unknown): string {
  return error instanceof ChatServiceError ? error.code : 'CHAT_UNAVAILABLE';
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
