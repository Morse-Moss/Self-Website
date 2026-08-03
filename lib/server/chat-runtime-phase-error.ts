import type { ChatServiceErrorCode } from '../contracts/chat.ts';

export class RuntimePhaseError extends Error {
  readonly publicCode: ChatServiceErrorCode;
  readonly logCode: string;
  readonly original: unknown;
  readonly preserveOriginal: boolean;

  constructor(
    publicCode: ChatServiceErrorCode,
    logCode: string,
    original?: unknown,
    preserveOriginal = false,
  ) {
    super(logCode);
    this.name = 'RuntimePhaseError';
    this.publicCode = publicCode;
    this.logCode = logCode;
    this.original = original;
    this.preserveOriginal = preserveOriginal;
  }
}
