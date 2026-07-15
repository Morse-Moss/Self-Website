export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const SSE_HEARTBEAT = ': heartbeat\n\n';

export interface SseScheduler {
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
}

export type SseEmitter = (event: string, data: unknown) => boolean;

interface CreateSseStreamInput {
  abortController: AbortController;
  parentSignal?: AbortSignal;
  heartbeatMs?: number;
  scheduler?: SseScheduler;
  run(signal: AbortSignal, emit: SseEmitter): Promise<void>;
}

const systemScheduler: SseScheduler = {
  setInterval(callback, delay) {
    const timer = setInterval(callback, delay);
    timer.unref?.();
    return timer;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function cancelReason(reason: unknown): unknown {
  return reason instanceof Error || reason instanceof DOMException
    ? reason
    : new DOMException('The response stream was cancelled.', 'AbortError');
}

export function createSseStream(input: CreateSseStreamInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const scheduler = input.scheduler ?? systemScheduler;
  const heartbeatMs = input.heartbeatMs ?? 15_000;
  const signal = input.abortController.signal;
  const parentSignal = input.parentSignal;
  const forwardParentAbort = () => {
    if (!signal.aborted) input.abortController.abort(signalReason(parentSignal!));
  };
  let listeningToParent = false;
  let finish = () => undefined;
  let completion: Promise<void> = Promise.resolve();

  if (parentSignal?.aborted) {
    forwardParentAbort();
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', forwardParentAbort, { once: true });
    listeningToParent = true;
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let terminal = false;
      let heartbeatHandle: unknown;

      const cleanup = () => {
        if (heartbeatHandle !== undefined) {
          scheduler.clearInterval(heartbeatHandle);
          heartbeatHandle = undefined;
        }
        signal.removeEventListener('abort', finish);
        if (listeningToParent) {
          parentSignal!.removeEventListener('abort', forwardParentAbort);
          listeningToParent = false;
        }
      };

      finish = () => {
        if (terminal) return;
        terminal = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // A cancelled stream is already terminal.
        }
      };

      const enqueue = (value: string): boolean => {
        if (terminal) return false;
        try {
          controller.enqueue(encoder.encode(value));
          return true;
        } catch {
          finish();
          return false;
        }
      };

      const emit: SseEmitter = (event, data) => {
        const emitted = enqueue(encodeSse(event, data));
        if (emitted && (event === 'done' || event === 'error')) finish();
        return emitted;
      };

      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) {
        finish();
        return;
      }

      heartbeatHandle = scheduler.setInterval(() => {
        enqueue(SSE_HEARTBEAT);
      }, heartbeatMs);
      completion = Promise.resolve()
        .then(() => input.run(signal, emit))
        .then(finish, finish);
    },
    cancel(reason) {
      if (!signal.aborted) input.abortController.abort(cancelReason(reason));
      finish();
      return completion;
    },
  });
}
