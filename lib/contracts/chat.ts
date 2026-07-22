export const CHAT_MODES = ['general', 'interviewer'] as const;
export type ChatMode = typeof CHAT_MODES[number];

export const CHAT_AUDIENCE_INTENTS = [
  'general',
  'recruiter',
  'collaboration',
  'peer',
] as const;
export type ChatAudienceIntent = typeof CHAT_AUDIENCE_INTENTS[number];

export const CHAT_WORKFLOWS = ['chat', 'jd_match', 'diagnosis'] as const;
export type ChatWorkflow = typeof CHAT_WORKFLOWS[number];

export const CHAT_BEHAVIOR_VERSIONS = ['v1', 'v2'] as const;
export type ChatBehaviorVersion = typeof CHAT_BEHAVIOR_VERSIONS[number];

export const CHAT_PHASES = [
  'routing',
  'knowledge',
  'web',
  'answering',
  'switching',
  'handoff',
] as const;
export type ChatPhase = typeof CHAT_PHASES[number];

export const CHAT_ROUTE_KINDS = [
  'conversation',
  'external_current',
  'identity',
  'personal_fact',
  'grounded',
  'jd_intake',
  'jd',
  'clarify',
] as const;
export type ChatRouteKind = typeof CHAT_ROUTE_KINDS[number];

export const CHAT_TOPIC_KINDS = [
  'none',
  'external',
  'project',
  'capability',
  'jd',
] as const;
export type ChatTopicKind = typeof CHAT_TOPIC_KINDS[number];

export const CHAT_EVIDENCE_CLASSES = [
  'none',
  'identity',
  'web',
  'direct',
  'transferable',
  'mixed',
  'unavailable',
] as const;
export type ChatEvidenceClass = typeof CHAT_EVIDENCE_CLASSES[number];

export const CHAT_SOURCE_KINDS = ['local', 'official', 'github', 'web'] as const;
export type ChatSourceKind = typeof CHAT_SOURCE_KINDS[number];

export interface ChatSource {
  id: string;
  title: string;
  href: string;
  kind: ChatSourceKind;
  domain: string | null;
  score: number | null;
}

export const DIAGNOSIS_FIELD_NAMES = [
  'problem',
  'goal',
  'currentState',
  'constraints',
  'expectedTimeline',
] as const;
export type DiagnosisFieldName = typeof DIAGNOSIS_FIELD_NAMES[number];

export interface DiagnosisFields {
  problem: string;
  goal: string;
  currentState: string;
  constraints: string;
  expectedTimeline: string;
}

export type DiagnosisStatus = 'collecting' | 'complete' | 'handoff_pending';
export type DiagnosisUiStatus = 'idle' | 'collecting' | 'handoff_pending';

export const BUDGET_LEVELS = ['normal', 'notice', 'warning', 'critical', 'exhausted'] as const;
export type BudgetLevel = typeof BUDGET_LEVELS[number];

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export const CHAT_ERROR_CODES = [
  'ACCESS_REQUIRED',
  'SESSION_INVALID',
  'MESSAGE_LIMIT',
  'BUDGET_EXHAUSTED',
  'RETRIEVAL_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INCOMPLETE',
  'CONVERSATION_BUSY',
  'CONVERSATION_INVALID',
  'CONVERSATION_MODE_MISMATCH',
  'CHAT_UNAVAILABLE',
] as const;
export type ChatErrorCode = typeof CHAT_ERROR_CODES[number];

export const CHAT_SERVICE_ERROR_CODES = [
  'SESSION_INVALID',
  'MESSAGE_LIMIT',
  'CONVERSATION_INVALID',
  'CONVERSATION_MODE_MISMATCH',
  'CONVERSATION_BUSY',
  'RETRIEVAL_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INCOMPLETE',
] as const satisfies readonly ChatErrorCode[];
export type ChatServiceErrorCode = typeof CHAT_SERVICE_ERROR_CODES[number];

export const RECOVERABLE_CHAT_ERROR_CODES = [
  'RETRIEVAL_UNAVAILABLE',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_INCOMPLETE',
  'CONVERSATION_BUSY',
  'CONVERSATION_INVALID',
  'CONVERSATION_MODE_MISMATCH',
  'CHAT_UNAVAILABLE',
] as const satisfies readonly ChatErrorCode[];

export type ChatServiceEvent =
  | { type: 'status'; stage: ChatPhase }
  | {
      type: 'meta';
      conversationId: string;
      budgetLevel: BudgetLevel;
      sources: ChatSource[];
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      usage: TokenUsage | null;
      budgetLevel: BudgetLevel;
      consumed: boolean;
      degraded: boolean;
      remainingMessages: number;
    };

export type ChatSseEventName = ChatServiceEvent['type'] | 'error';

export interface ChatSsePayload {
  type?: ChatServiceEvent['type'];
  code?: ChatErrorCode;
  stage?: ChatPhase;
  conversationId?: string;
  budgetLevel?: BudgetLevel;
  sources?: ChatSource[];
  text?: string;
  usage?: TokenUsage | null;
  consumed?: boolean;
  degraded?: boolean;
  remainingMessages?: number;
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  turnId: string | null;
  text: string;
  sources: ChatSource[];
}

export interface ChatHistoryPayload {
  ok?: boolean;
  conversationId: string | null;
  workflow: ChatWorkflow | null;
  audienceIntent: ChatAudienceIntent | null;
  messages: ChatHistoryMessage[];
  remainingMessages: number;
  error?: string;
}
