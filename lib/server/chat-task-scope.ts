import { createHash } from 'node:crypto';

import type {
  CandidateConversationTaskFrameV22,
  CompletedContextTurn,
  ContextTaskAction,
  ContextWaitingFor,
  ConversationTaskFrameV22,
  ResolvedTaskSlotRef,
  SemanticIntent,
} from '../contracts/chat-context.ts';
import type { ChatAudienceIntent, ChatMode, ChatWorkflow } from '../contracts/chat.ts';

export type ChatTaskScopeCommand = 'none' | 'switch' | 'clear' | 'complete';

export interface ChatTaskScopeInput {
  currentFrame: ConversationTaskFrameV22 | null;
  adjacentCompletedTurn: CompletedContextTurn | null;
  workflow: ChatWorkflow;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  contentIntent: SemanticIntent;
  independentOneShot: boolean;
  explicitCommand: ChatTaskScopeCommand;
  hasAdjacentBoundary?: boolean;
  unsafe?: boolean;
}

export interface ChatTaskScopeDecision {
  taskAction: ContextTaskAction;
  taskId: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeChatTaskSlots(slots: ResolvedTaskSlotRef[]): ResolvedTaskSlotRef[] {
  const seenJobHashes = new Set<string>();
  const validated = slots.filter((candidate) => {
    if (!/^[1-9]\d*$/u.test(candidate.sourceMessageId)) {
      throw new Error('CONTEXT_SLOT_SOURCE_MESSAGE_ID_INVALID');
    }
    if (!Number.isSafeInteger(candidate.startUtf16)
      || !Number.isSafeInteger(candidate.endUtf16)
      || candidate.startUtf16 < 0
      || candidate.endUtf16 <= candidate.startUtf16
      || candidate.endUtf16 - candidate.startUtf16 !== candidate.text.length) {
      throw new Error('CONTEXT_SLOT_SOURCE_SPAN_INVALID');
    }
    if (!/^[0-9a-f]{64}$/u.test(candidate.contentSha256)
      || sha256(candidate.text) !== candidate.contentSha256) {
      throw new Error('CONTEXT_SLOT_SOURCE_HASH_MISMATCH');
    }
    if (candidate.slot === 'job_description') {
      if (seenJobHashes.has(candidate.contentSha256)) return false;
      seenJobHashes.add(candidate.contentSha256);
    }
    return true;
  });
  const ordered = [...validated].sort((left, right) => (
    BigInt(left.sourceMessageId) < BigInt(right.sourceMessageId) ? -1
      : BigInt(left.sourceMessageId) > BigInt(right.sourceMessageId) ? 1
        : left.startUtf16 - right.startUtf16
          || left.endUtf16 - right.endUtf16
          || left.contentSha256.localeCompare(right.contentSha256)
  ));
  const nextOrdinal = new Map<ResolvedTaskSlotRef['slot'], number>();
  return ordered.map((candidate) => {
    const ordinal = nextOrdinal.get(candidate.slot) ?? 0;
    nextOrdinal.set(candidate.slot, ordinal + 1);
    return { ...candidate, ordinal };
  });
}

export function buildChatTaskScopeFrame(input: {
  conversationId: string;
  currentUserMessageId: string;
  currentFrame: ConversationTaskFrameV22 | null;
  taskAction: ContextTaskAction;
  intent: SemanticIntent;
  message: string;
  workflow: ChatWorkflow;
  taskIdFactory: () => string;
  clear: Set<ResolvedTaskSlotRef['slot']>;
  extractedSlots: ResolvedTaskSlotRef[];
}): CandidateConversationTaskFrameV22 | null {
  if (!['create', 'continue', 'switch', 'wait', 'complete'].includes(input.taskAction)) return null;
  const reuse = input.currentFrame
    && input.currentFrame.status !== 'completed'
    && !['create', 'switch'].includes(input.taskAction);
  const taskId = reuse ? input.currentFrame!.taskId : input.taskIdFactory();
  let slots = reuse ? [...input.currentFrame!.slots] : [];
  if (!reuse || input.taskAction === 'switch') slots = [];
  slots = slots.filter((candidate) => !input.clear.has(candidate.slot));

  const replaceWholeJd = input.workflow === 'jd_match'
    || !reuse
    || input.taskAction === 'switch'
    || /(?:另一份|新的|完整)\s*(?:JD|职位描述)|(?:JD|职位描述)\s*(?:替换|改成)/iu.test(input.message);
  for (const candidate of input.extractedSlots) {
    if (candidate.slot === 'job_description') {
      if (replaceWholeJd) slots = slots.filter((existing) => existing.slot !== 'job_description');
      slots.push(candidate);
    } else {
      slots = slots.filter((existing) => existing.slot !== candidate.slot);
      slots.push(candidate);
    }
  }
  slots = normalizeChatTaskSlots(slots);

  let waitingFor: ContextWaitingFor[] = [];
  if (input.taskAction === 'wait') {
    if (input.clear.has('company') && slots.some((candidate) => candidate.slot === 'role')) {
      waitingFor = ['company'];
    } else if (input.clear.has('role') && slots.some((candidate) => candidate.slot === 'company')) {
      waitingFor = ['role'];
    } else if (input.clear.has('job_description')) {
      waitingFor = ['job_description'];
    } else {
      waitingFor = ['relevance_referent'];
    }
  }
  const status = input.taskAction === 'complete'
    ? 'completed'
    : waitingFor.length > 0 ? 'waiting_input' : 'active';
  return {
    conversationId: input.conversationId,
    taskId,
    expectedVersion: input.currentFrame?.version ?? 0,
    taskKind: reuse
      ? input.currentFrame!.taskKind
      : input.workflow === 'jd_match' ? 'jd_match' : 'recruitment_evaluation',
    subjectKind: 'morse',
    subjectRef: 'recruitment',
    evidenceFocus: {
      topicKind: input.intent === 'jd_match' ? 'jd' : input.intent === 'project_fit' ? 'project' : 'none',
      topicRef: null,
    },
    status,
    closedReason: status === 'completed' ? 'task_complete' : null,
    waitingFor,
    taskStartedMessageId: reuse
      ? input.currentFrame!.taskStartedMessageId
      : input.currentUserMessageId,
    slots,
  };
}

export function hasActiveRecruitmentScope(frame: ConversationTaskFrameV22 | null): boolean {
  return Boolean(frame
    && frame.status !== 'completed'
    && (frame.taskKind === 'recruitment_evaluation' || frame.taskKind === 'jd_match'));
}

function hasAdjacentRecruiterBoundary(input: ChatTaskScopeInput): boolean {
  return Boolean(
    hasActiveRecruitmentScope(input.currentFrame)
    && input.workflow === 'chat'
    && input.mode === 'interviewer'
    && input.audienceIntent === 'recruiter'
    && input.adjacentCompletedTurn?.contextScopeId === input.currentFrame?.taskId,
  );
}

export function decideChatTaskScope(input: ChatTaskScopeInput): ChatTaskScopeDecision {
  const active = hasActiveRecruitmentScope(input.currentFrame);
  const taskId = input.currentFrame?.taskId ?? null;

  if (input.unsafe || input.independentOneShot) return { taskAction: 'temporary', taskId };
  if (input.explicitCommand === 'complete') return { taskAction: 'complete', taskId };
  if (input.explicitCommand === 'switch') return { taskAction: 'switch', taskId };
  if (input.explicitCommand === 'clear') return {
    taskAction: active ? 'wait' : 'temporary',
    taskId,
  };
  if (input.hasAdjacentBoundary ?? hasAdjacentRecruiterBoundary(input)) {
    return { taskAction: 'continue', taskId };
  }
  if (active && ['jd_match', 'project_fit', 'recruitment_intake'].includes(input.contentIntent)) {
    return { taskAction: 'continue', taskId };
  }
  return {
    taskAction: input.contentIntent === 'jd_match' || input.contentIntent === 'project_fit'
      || input.contentIntent === 'recruitment_intake'
      ? 'create'
      : 'temporary',
    taskId,
  };
}
