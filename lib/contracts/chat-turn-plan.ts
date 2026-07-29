import type {
  ChatAudienceIntent,
  ChatSource,
  ChatMode,
  TokenUsage,
  ChatWorkflow,
} from './chat.ts';
import type {
  CandidateConversationTaskFrameV22,
  CompletedContextTurn,
  ConversationTaskFrameV22,
  SemanticTurnDecision,
} from './chat-context.ts';
import type { ProjectSlug } from './site-content.ts';
import type { ProviderAttempt, ProviderWinner } from '../server/ai-provider.ts';

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

export type AnswerValidationIssueCode =
  | 'missing_evidence_coverage'
  | 'invalid_citation'
  | 'unsupported_capability_claim'
  | 'private_data_leak'
  | 'secret_leak';

export interface AnswerValidationResult {
  verdict: 'pass' | 'warn' | 'block';
  issues: readonly {
    code: AnswerValidationIssueCode;
    evidenceId: string | null;
  }[];
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
