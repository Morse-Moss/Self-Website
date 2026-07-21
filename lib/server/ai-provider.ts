import type { TokenUsage } from './budget.ts';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AnswerReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export interface AnswerRequest {
  instructions: string;
  messages: AiMessage[];
  reasoningEffort?: AnswerReasoningEffort;
}

export type ProviderSourceType = 'database' | 'environment';

export interface ProviderTargetSnapshot {
  configDigest: string;
  connectionDisplayName: string;
  connectionVersionId: string | null;
  inputUsdPerMillion: string | null;
  modelDisplayName: string;
  modelId: string;
  modelVersionId: string | null;
  outputUsdPerMillion: string | null;
  position: number;
  protocol: 'responses' | 'chat_completions';
  routeRevisionId: string | null;
  sourceType: ProviderSourceType;
}

export interface ProviderAttempt extends ProviderTargetSnapshot {
  attemptIndex: number;
  completedAt: Date;
  costComplete: boolean;
  errorCode: string | null;
  firstByteLatencyMs: number | null;
  knownCostUsd: number | null;
  startedAt: Date;
  status: 'completed' | 'failed' | 'stopped';
  totalLatencyMs: number;
  usage: TokenUsage | null;
  usageComplete: boolean;
}

export interface ProviderWinner extends ProviderTargetSnapshot {
  attemptIndex: number;
}

export interface ProviderAnswerTarget {
  provider: AiProvider;
  snapshot: ProviderTargetSnapshot;
}

export class ProviderRunError extends Error {
  readonly code: string;
  readonly attempts: ProviderAttempt[];

  constructor(code: string, attempts: ProviderAttempt[]) {
    super(code);
    this.name = 'ProviderRunError';
    this.code = code;
    this.attempts = attempts;
  }
}

export type AnswerEvent =
  | { type: 'delta'; text: string }
  | { type: 'attempt'; attempt: ProviderAttempt }
  | {
      type: 'done';
      attempts?: ProviderAttempt[];
      costComplete?: boolean;
      knownCostUsd?: number | null;
      usage: TokenUsage | null;
      usageComplete?: boolean;
      winner?: ProviderWinner | null;
    };

export interface AiProvider {
  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>;
  streamAnswer(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<AnswerEvent>;
}
