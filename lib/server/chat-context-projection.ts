import {
  CONTEXT_PROJECTION_VERSION,
  type CandidateConversationTaskFrameV22,
  type CompletedContextTurn,
  type ContextLayerName,
  type ContextProjection,
  type ConversationTaskFrameV22,
  type ProjectedContextTaskFrameV22,
  type ResolvedChatTurn,
} from '../contracts/chat-context.ts';
import type { KnowledgeSource } from '../contracts/chat-runtime.ts';

const LAYER_ORDER: readonly ContextLayerName[] = [
  'current_input',
  'discourse_context',
  'task_frame',
  'task_inputs',
  'task_history',
  'approved_evidence',
];

type ProjectableFrame = CandidateConversationTaskFrameV22 | ConversationTaskFrameV22;

export interface FinalContextProjectionInput {
  resolved: ResolvedChatTurn;
  currentUserMessageId: string;
  discourse: CompletedContextTurn | null;
  frame: ProjectableFrame | null;
  history: readonly CompletedContextTurn[];
  approvedEvidence: readonly KnowledgeSource[];
}

function projectFrame(frame: ProjectableFrame): ProjectedContextTaskFrameV22 {
  return {
    taskId: frame.taskId,
    taskKind: frame.taskKind,
    subjectKind: frame.subjectKind,
    subjectRef: frame.subjectRef,
    evidenceFocus: { ...frame.evidenceFocus },
    status: frame.status,
    closedReason: frame.closedReason,
    waitingFor: [...frame.waitingFor],
    taskStartedMessageId: frame.taskStartedMessageId,
    taskStateVersion: 'expectedVersion' in frame ? frame.expectedVersion : frame.version,
  };
}

function finish(input: {
  discourse: ContextProjection['discourse'];
  frame: ContextProjection['frame'];
  slots: ContextProjection['slots'];
  history: ContextProjection['history'];
  evidence: ContextProjection['evidence'];
  reasonCodes: string[];
}): ContextProjection {
  const included = new Set<ContextLayerName>(['current_input']);
  if (input.discourse) included.add('discourse_context');
  if (input.frame) included.add('task_frame');
  if (input.slots.length > 0) included.add('task_inputs');
  if (input.history.length > 0) included.add('task_history');
  if (input.evidence.length > 0) included.add('approved_evidence');
  return {
    version: CONTEXT_PROJECTION_VERSION,
    discourse: input.discourse,
    frame: input.frame,
    slots: [...input.slots],
    history: [...input.history],
    evidence: [...input.evidence],
    includedLayers: LAYER_ORDER.filter((layer) => included.has(layer)),
    excludedLayers: LAYER_ORDER.filter((layer) => !included.has(layer)),
    reasonCodes: [...new Set(input.reasonCodes)],
  };
}

function currentTaskHistory(
  history: readonly CompletedContextTurn[],
  frame: ProjectedContextTaskFrameV22 | null,
  discourse: CompletedContextTurn | null,
): CompletedContextTurn[] {
  if (!frame) return [];
  const seen = new Set<string>();
  const result: CompletedContextTurn[] = [];
  for (const turn of history) {
    if (turn.contextScopeId !== frame.taskId || turn.turnId === discourse?.turnId || seen.has(turn.turnId)) {
      continue;
    }
    seen.add(turn.turnId);
    result.push(turn);
  }
  return result;
}

export function projectFinalContext(input: FinalContextProjectionInput): ContextProjection {
  const { semantic, legacyRoute } = input.resolved;
  if (legacyRoute.deterministicReply || semantic.taskAction === 'wait' || semantic.intent === 'clarify') {
    return finish({
      discourse: null,
      frame: null,
      slots: [],
      history: [],
      evidence: [],
      reasonCodes: ['projection_deterministic_no_provider'],
    });
  }

  if (semantic.taskAction === 'temporary' || semantic.discourseAction === 'one_shot') {
    const explicitReference = semantic.discourseAction === 'follow_up'
      && semantic.reasonCodes.includes('explicit_discourse_reference');
    const evidence = ['identity_fact', 'project_catalog', 'named_project_fact', 'capability_fact', 'external_current']
      .includes(semantic.intent)
      ? [...input.approvedEvidence]
      : [];
    return finish({
      discourse: explicitReference ? input.discourse : null,
      frame: null,
      slots: [],
      history: [],
      evidence,
      reasonCodes: [
        'projection_temporary_isolated',
        ...(explicitReference ? ['projection_explicit_discourse_reference'] : []),
      ],
    });
  }

  const frame = input.frame ? projectFrame(input.frame) : null;
  if (semantic.taskAction === 'create' || semantic.taskAction === 'switch'
    || semantic.discourseAction === 'new_task') {
    const slots = input.frame?.slots.filter(
      (candidate) => candidate.sourceMessageId === input.currentUserMessageId,
    ) ?? [];
    const explicitReference = semantic.reasonCodes.includes('explicit_discourse_reference');
    return finish({
      discourse: explicitReference ? input.discourse : null,
      frame,
      slots,
      history: [],
      evidence: [...input.approvedEvidence],
      reasonCodes: [
        'projection_new_task_excludes_prior_context',
        ...(explicitReference ? ['projection_explicit_discourse_reference'] : []),
      ],
    });
  }

  const discourse = semantic.discourseAction === 'follow_up'
    || semantic.discourseAction === 'correction'
    || semantic.taskAction === 'complete'
    ? input.discourse
    : null;
  return finish({
    discourse,
    frame,
    slots: input.frame?.slots ?? [],
    history: semantic.taskAction === 'complete'
      ? []
      : currentTaskHistory(input.history, frame, discourse),
    evidence: [...input.approvedEvidence],
    reasonCodes: [
      semantic.taskAction === 'complete'
        ? 'projection_task_complete_minimal'
        : 'projection_follow_up_current_task',
    ],
  });
}
