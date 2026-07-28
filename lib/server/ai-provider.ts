import type { TokenUsage } from './budget.ts';
import type { ChatExecutionBudget } from './chat-execution-budget.ts';
import type {
  CanonicalGenerationRequestV2,
  GenerationRequestIntegrity,
  GenerationRequestIntegrityV2,
  GenerationVariantV2,
} from '../contracts/chat-context.ts';
import type {
  AiConfigDigestVersion,
  ModelCapabilities,
} from './ai-config.ts';
import type { PreparedTargetContext } from './chat-context-coordinator.ts';
import type { SanitizedProviderFailure } from './provider-failure.ts';

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
  maxOutputTokens?: number | null;
  preparedOutboundBody?: Readonly<Record<string, unknown>>;
  reasoningEffort?: AnswerReasoningEffort;
  execution?: AnswerExecutionOptions;
}

export type ProviderAttemptEvent =
  | { type: 'started'; attemptNo: number; providerAlias: string; launchKind: 'primary' | 'hedge' | 'failover' | 'overflow_retry'; generationMode: 'normal' | 'strict'; generationVariantTrigger?: GenerationVariantV2['trigger']; integrity?: GenerationRequestIntegrity; startedAt: Date; startDelayMs: number }
  | { type: 'first_byte'; attemptNo: number; providerAlias: string; firstByteMs: number }
  | { type: 'first_protocol' | 'first_model_text' | 'first_user_visible'; attemptNo: number; providerAlias: string; elapsedMs: number }
  | { type: 'completed' | 'failed' | 'aborted'; attemptNo: number; providerAlias: string; durationMs: number; winner: boolean; errorCode: string | null; usage: TokenUsage | null; estimatedCostUsd?: number | null; failure?: SanitizedProviderFailure | null };

export interface AnswerExecutionOptions {
  executionId: string;
  generationVariantId?: string;
  releasePolicy: 'segment' | 'complete';
  minimumBufferCharacters: number;
  totalTimeoutMs: number;
  budget: ChatExecutionBudget;
  generationMode: 'normal' | 'strict';
  integrity?: GenerationRequestIntegrity;
  protocolEventTimeoutMs: number;
  modelTextTimeoutMs: number;
  hedgingEnabled: boolean;
  delaysMs: readonly number[];
  prepareTarget?(input: {
    target: ProviderTargetSnapshot;
    provider: AiProvider;
    variantId: string;
    revision: number;
    trigger: GenerationVariantV2['trigger'];
    numericOverflow: SanitizedProviderFailure | null;
    signal: AbortSignal;
    deadlineMs: number;
  }): Promise<PreparedTargetAnswer>;
  reserveHedgedAttempt(event: Extract<ProviderAttemptEvent, { type: 'started' }>): Promise<boolean>;
  onAttempt(event: ProviderAttemptEvent): Promise<void>;
}

export interface PreparedTargetAnswer {
  context: PreparedTargetContext;
  request: AnswerRequest;
  outboundBody: Readonly<Record<string, unknown>>;
  generationRequest: CanonicalGenerationRequestV2;
  integrity: GenerationRequestIntegrityV2;
}

export type AnswerExecutionErrorCode = 'PROVIDER_INCOMPLETE';

export class AnswerExecutionError extends Error {
  readonly code: AnswerExecutionErrorCode;
  constructor(code: AnswerExecutionErrorCode) {
    super(code);
    this.name = 'AnswerExecutionError';
    this.code = code;
  }
}

export type ProviderSourceType = 'database' | 'environment';

export interface ProviderTargetSnapshot extends ModelCapabilities {
  configDigest: string;
  configDigestVersion: AiConfigDigestVersion;
  connectionDisplayName: string;
  connectionVersionId: string | null;
  inputUsdPerMillion: string | null;
  modelDisplayName: string;
  modelId: string;
  modelVersionId: string | null;
  outputUsdPerMillion: string | null;
  position: number;
  protocol: 'responses' | 'chat_completions';
  reasoningEffort: AnswerReasoningEffort | null;
  routeRevisionId: string | null;
  sourceType: ProviderSourceType;
}

export interface ProviderAttempt extends ProviderTargetSnapshot {
  attemptIndex: number;
  completedAt: Date;
  costComplete: boolean;
  errorCode: string | null;
  firstByteLatencyMs: number | null;
  firstModelTextMs: number | null;
  firstProtocolEventMs: number | null;
  firstUserVisibleMs: number | null;
  generationMode: 'normal' | 'strict';
  generationVariantTrigger?: GenerationVariantV2['trigger'] | null;
  knownCostUsd: number | null;
  launchKind: 'primary' | 'hedge' | 'failover' | 'overflow_retry';
  startedAt: Date;
  status: 'completed' | 'failed' | 'stopped';
  totalLatencyMs: number;
  usage: TokenUsage | null;
  usageComplete: boolean;
  executionId?: string;
  attemptNo?: number;
  integrity?: GenerationRequestIntegrity | null;
  failure?: SanitizedProviderFailure | null;
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
  | { type: 'activity'; kind: 'protocol' | 'model_text'; elapsedMs: number }
  | { type: 'switching' }
  | { type: 'attempt'; attempt: ProviderAttempt }
  | {
      type: 'done';
      attempts?: ProviderAttempt[];
      costComplete?: boolean;
      knownCostUsd?: number | null;
      providerAlias?: string;
      usage: TokenUsage | null;
      usageComplete?: boolean;
      winner?: ProviderWinner | null;
    };

export interface AiProvider {
  embed(inputs: string[], signal?: AbortSignal): Promise<number[][]>;
  streamAnswer(request: AnswerRequest, signal?: AbortSignal): AsyncIterable<AnswerEvent>;
}
