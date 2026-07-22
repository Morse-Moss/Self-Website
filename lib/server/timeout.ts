export type OperationTimeoutCode =
  | 'CHAT_TURN_TIMEOUT'
  | 'EMBEDDING_TIMEOUT'
  | 'PROVIDER_FIRST_BYTE_TIMEOUT'
  | 'PROVIDER_PROTOCOL_TIMEOUT'
  | 'PROVIDER_MODEL_TEXT_TIMEOUT'
  | 'PROVIDER_TOTAL_TIMEOUT';

export class OperationTimeoutError extends Error {
  readonly code: OperationTimeoutCode;

  constructor(code: OperationTimeoutCode) {
    super(code);
    this.name = 'OperationTimeoutError';
    this.code = code;
  }
}

interface TimeoutSignalOptions {
  timeoutMs: number;
  code: OperationTimeoutCode;
  signal?: AbortSignal;
}

export interface TimeoutSignal {
  signal: AbortSignal;
  abort(reason?: unknown): void;
  cancelTimeout(): void;
  dispose(): void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export function createTimeoutSignal(options: TimeoutSignalOptions): TimeoutSignal {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const forwardExternalAbort = () => {
    controller.abort(abortReason(externalSignal!));
  };
  let listening = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (externalSignal?.aborted) {
    forwardExternalAbort();
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', forwardExternalAbort, { once: true });
    listening = true;
  }

  if (!controller.signal.aborted) {
    timer = setTimeout(() => {
      timer = undefined;
      controller.abort(new OperationTimeoutError(options.code));
    }, options.timeoutMs);
    timer.unref?.();
  }

  const cancelTimeout = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    signal: controller.signal,
    abort(reason = new DOMException('The operation was aborted.', 'AbortError')) {
      cancelTimeout();
      controller.abort(reason);
    },
    cancelTimeout,
    dispose() {
      cancelTimeout();
      if (listening) {
        externalSignal!.removeEventListener('abort', forwardExternalAbort);
        listening = false;
      }
    },
  };
}

export function raceWithSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
