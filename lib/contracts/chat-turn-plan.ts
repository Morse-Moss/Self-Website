import type {
  ChatAudienceIntent,
  ChatSource,
  ChatMode,
  TokenUsage,
  ChatWorkflow,
} from './chat.ts';
import type {
  AnswerValidationIssueCode,
  CandidateConversationTaskFrameV22,
  CompletedContextTurn,
  ContextReasoningEffort,
  ConversationTaskFrameV22,
  GenerationRequestIntegrity,
  GenerationVariantV2,
  SemanticTurnDecision,
} from './chat-context.ts';
import type { ProjectSlug } from './site-content.ts';

export type { AnswerValidationIssueCode } from './chat-context.ts';

export const TURN_PLAN_VERSION = 'turn-plan-v1' as const;
export const TURN_PLANNER_VERSION = 'deterministic-turn-planner-v1' as const;

export interface ConversationSessionSnapshot {
  conversationId: string;
  interactionTurnId: string;
  currentUserMessageId: string;
  currentInput: string;
  workflow: ChatWorkflow;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  pageContext: Readonly<Record<string, string>> | null;
  currentFrame: ConversationTaskFrameV22 | null;
  adjacentCompletedTurn: CompletedContextTurn | null;
  completedHistory: readonly CompletedContextTurn[];
  legacyBridge: readonly CompletedContextTurn[];
}

export type EvidenceRequirement =
  | { kind: 'none' }
  | { kind: 'identity' }
  | { kind: 'portfolio_full'; rankForQuestion: boolean }
  | { kind: 'named_projects'; projectSlugs: readonly ProjectSlug[] }
  | { kind: 'capabilities'; capabilityIds: readonly string[]; includePortfolio: boolean }
  | { kind: 'controlled_search' };

export interface TurnPlanV1 {
  schemaVersion: typeof TURN_PLAN_VERSION;
  plannerVersion: typeof TURN_PLANNER_VERSION;
  conversationId: string;
  interactionTurnId: string;
  currentUserMessageId: string;
  semantic: SemanticTurnDecision;
  taskId: string | null;
  candidateFrame: CandidateConversationTaskFrameV22 | null;
  evidence: EvidenceRequirement;
  executor: { kind: 'direct' };
  reasonCodes: readonly string[];
}

export interface AnswerValidationResult {
  verdict: 'pass' | 'warn' | 'block';
  issues: readonly {
    code: AnswerValidationIssueCode;
    evidenceId: string | null;
  }[];
}

export interface ProviderTargetSnapshot {
  configDigest: string;
  configDigestVersion: 1 | 2;
  connectionDisplayName: string;
  connectionVersionId: string | null;
  contextWindowTokens: number | null;
  inputUsdPerMillion: string | null;
  maxOutputTokens: number | null;
  modelDisplayName: string;
  modelId: string;
  modelVersionId: string | null;
  outputUsdPerMillion: string | null;
  position: number;
  protocol: 'responses' | 'chat_completions';
  reasoningEffort: ContextReasoningEffort | null;
  routeRevisionId: string | null;
  sourceType: 'database' | 'environment';
}

export type ProviderFailureCategory =
  | 'context_overflow'
  | 'output_truncated'
  | 'incomplete'
  | 'provider_failed'
  | 'transport'
  | 'timeout'
  | 'cancelled';

export type ProviderFailureReason =
  | 'http_413'
  | 'context_length_exceeded'
  | 'max_output_tokens'
  | 'length'
  | 'response_incomplete'
  | 'response_failed'
  | 'stream_failed'
  | 'transport'
  | 'timeout'
  | 'cancelled';

export interface SanitizedProviderFailure {
  category: ProviderFailureCategory;
  reason: ProviderFailureReason;
  httpStatus: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  contextWindowTokens: number | null;
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

export interface AnswerCandidate {
  executorKind: 'direct';
  text: string;
  usage: TokenUsage | null;
  attempts: readonly ProviderAttempt[];
  winner: ProviderWinner | null;
  sources: readonly ChatSource[];
}

export interface AnswerExecutor<Input> {
  execute(input: Input, signal: AbortSignal): Promise<AnswerCandidate>;
}
