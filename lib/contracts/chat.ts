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

export const CHAT_PHASES = ['routing', 'knowledge', 'web', 'answering', 'handoff'] as const;
export type ChatPhase = typeof CHAT_PHASES[number];

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
