export type SemaphoreRelease = () => void;

interface Waiter {
  resolve: (release: SemaphoreRelease) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export class Semaphore {
  private available: number;
  private readonly queue: Waiter[] = [];

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('Semaphore capacity must be a positive integer.');
    }
    this.available = capacity;
  }

  acquire(signal?: AbortSignal): Promise<SemaphoreRelease> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    if (this.available > 0 && this.queue.length === 0) {
      this.available -= 1;
      return Promise.resolve(this.createRelease());
    }

    return new Promise<SemaphoreRelease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index === -1) return;
          this.queue.splice(index, 1);
          signal.removeEventListener('abort', waiter.onAbort!);
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private createRelease(): SemaphoreRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    const waiter = this.queue.shift();
    if (!waiter) {
      this.available += 1;
      return;
    }

    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
    waiter.resolve(this.createRelease());
  }
}
