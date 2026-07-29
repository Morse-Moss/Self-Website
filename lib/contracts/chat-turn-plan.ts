import type {
  ChatAudienceIntent,
  ChatMode,
  ChatWorkflow,
} from './chat.ts';
import type {
  CompletedContextTurn,
  ConversationTaskFrameV22,
} from './chat-context.ts';

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
}
