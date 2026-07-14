export interface ChatSsePayload {
  code?: string;
}

class ChatSseError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'ChatSseError';
  }
}

export async function readChatSse<T extends ChatSsePayload>(
  response: Response,
  onEvent: (event: string, payload: T) => void,
): Promise<void> {
  if (!response.body) throw new ChatSseError('CHAT_UNAVAILABLE');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll('\r\n', '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        if (!frame.trim() || frame.startsWith(':')) continue;

        const event = frame.split('\n').find((line) => line.startsWith('event: '))?.slice(7) ?? '';
        const data = frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6) ?? '';
        if (!event || !data) throw new ChatSseError('PROVIDER_INCOMPLETE');

        let payload: T;
        try {
          payload = JSON.parse(data) as T;
        } catch {
          throw new ChatSseError('PROVIDER_INCOMPLETE');
        }
        if (event === 'error') {
          throw new ChatSseError(payload.code || 'PROVIDER_INCOMPLETE');
        }
        onEvent(event, payload);
        if (event === 'done') {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }

      if (done) break;
    }

    throw new ChatSseError('PROVIDER_INCOMPLETE');
  } catch (error) {
    if (error instanceof ChatSseError) throw error;
    throw new ChatSseError('PROVIDER_INCOMPLETE');
  } finally {
    reader.releaseLock();
  }
}
