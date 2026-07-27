import type { ChatRouteDecision, KnowledgeSource } from './chat-runtime.ts';

export interface ContextChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ContextReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export const CONTEXT_PIPELINE_VERSION = 'context-packet-v22' as const;
export const CONTEXT_BUILDER_VERSION = 'context-packet-builder-v1' as const;
export const CONTEXT_PROJECTION_VERSION = 'final-context-projection-v1' as const;
export const CONTEXT_SLOT_EXTRACTOR_VERSION = 'recruitment-slots-v1' as const;
export const LEGACY_BRIDGE_VERSION = 'legacy-discourse-bridge-v1' as const;

export type ContextPipelineAssignment =
  | 'legacy'
  | 'context_packet_v22'
  | 'legacy_locked_after_v22';

export type ContextExecutionPipeline =
  | 'legacy_v1'
  | 'legacy_v2'
  | 'safe'
  | 'context_packet_v22';

export type SemanticIntent =
  | 'identity_fact'
  | 'project_catalog'
  | 'project_fit'
  | 'named_project_fact'
  | 'capability_fact'
  | 'jd_match'
  | 'recruitment_intake'
  | 'unsupported_personal_history'
  | 'external_current'
  | 'general_conversation'
  | 'clarify';

export type DiscourseAction = 'follow_up' | 'correction' | 'new_task' | 'one_shot';
export type ContextTaskAction = 'create' | 'continue' | 'switch' | 'temporary' | 'wait' | 'complete';
export type ContextWaitingFor = 'company' | 'role' | 'job_description' | 'relevance_referent';
export type ContextTaskKind =
  | 'recruitment_evaluation'
  | 'project_discussion'
  | 'capability_verification'
  | 'jd_match'
  | 'external_research';
export type ContextSubjectKind = 'morse' | 'portfolio' | 'project' | 'capability' | 'external';
export type ContextEvidenceTopicKind = 'project' | 'capability' | 'jd' | 'external' | 'none';

export type EvidencePlanCode =
  | 'identity_card'
  | 'approved_project_catalog'
  | 'ranked_project_fit'
  | 'named_approved_project'
  | 'capability_ledger'
  | 'controlled_search'
  | 'none';

export interface SemanticTurnDecision {
  discourseAction: DiscourseAction;
  subject: 'morse' | 'general' | 'unknown';
  intent: SemanticIntent;
  taskAction: ContextTaskAction;
  referent: {
    kind: 'company' | 'role' | 'project' | 'capability' | 'jd' | 'external';
    ref: string;
  } | null;
  evidencePlan: EvidencePlanCode[];
  confidence: number;
  reasonCodes: string[];
}

export interface ResolvedChatTurn {
  semantic: SemanticTurnDecision;
  legacyRoute: ChatRouteDecision;
}

export interface TaskSlotRef {
  slot: 'company' | 'role' | 'job_description';
  sourceMessageId: string;
  startUtf16: number;
  endUtf16: number;
  contentSha256: string;
  extractorVersion: typeof CONTEXT_SLOT_EXTRACTOR_VERSION;
  ordinal: number;
}

export interface ResolvedTaskSlotRef extends TaskSlotRef {
  text: string;
}

export interface ConversationTaskFrameV22 {
  conversationId: string;
  taskId: string;
  taskKind: ContextTaskKind;
  subjectKind: ContextSubjectKind;
  subjectRef: string;
  evidenceFocus: {
    topicKind: ContextEvidenceTopicKind;
    topicRef: string | null;
  };
  status: 'active' | 'waiting_input' | 'completed';
  closedReason: 'task_complete' | 'pipeline_rollback' | null;
  waitingFor: ContextWaitingFor[];
  taskStartedMessageId: string;
  lastSuccessfulMessageId: string;
  version: number;
  updatedByMessageId: string;
  createdAt: Date;
  updatedAt: Date;
  slots: ResolvedTaskSlotRef[];
}

export interface CandidateConversationTaskFrameV22 {
  conversationId: string;
  taskId: string;
  expectedVersion: number;
  taskKind: ContextTaskKind;
  subjectKind: ContextSubjectKind;
  subjectRef: string;
  evidenceFocus: {
    topicKind: ContextEvidenceTopicKind;
    topicRef: string | null;
  };
  status: ConversationTaskFrameV22['status'];
  closedReason: ConversationTaskFrameV22['closedReason'];
  waitingFor: ContextWaitingFor[];
  taskStartedMessageId: string;
  slots: ResolvedTaskSlotRef[];
}

export interface ProjectedContextTaskFrameV22 {
  taskId: string;
  taskKind: ContextTaskKind;
  subjectKind: ContextSubjectKind;
  subjectRef: string;
  evidenceFocus: {
    topicKind: ContextEvidenceTopicKind;
    topicRef: string | null;
  };
  status: ConversationTaskFrameV22['status'];
  closedReason: ConversationTaskFrameV22['closedReason'];
  waitingFor: ContextWaitingFor[];
  taskStartedMessageId: string;
  taskStateVersion: number;
}

export interface CompletedContextMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface CompletedContextTurn {
  conversationId: string;
  turnId: string;
  contextScopeId: string;
  user: CompletedContextMessage & { role: 'user' };
  assistant: CompletedContextMessage & { role: 'assistant' };
  completedAt: Date;
}

export type ContextLayerName =
  | 'current_input'
  | 'discourse_context'
  | 'task_frame'
  | 'task_inputs'
  | 'task_history'
  | 'approved_evidence';

export interface ContextProjection {
  version: typeof CONTEXT_PROJECTION_VERSION;
  discourse: CompletedContextTurn | null;
  frame: ProjectedContextTaskFrameV22 | null;
  slots: ResolvedTaskSlotRef[];
  history: CompletedContextTurn[];
  evidence: KnowledgeSource[];
  includedLayers: ContextLayerName[];
  excludedLayers: ContextLayerName[];
  reasonCodes: string[];
}

export interface ContextPacketManifest {
  pipeline_version: typeof CONTEXT_PIPELINE_VERSION;
  semantic_intent: SemanticIntent;
  discourse_action: DiscourseAction;
  task_action: ContextTaskAction;
  task_id: string;
  task_state_version: number;
  context_builder_version: typeof CONTEXT_BUILDER_VERSION;
  projection_policy_version: typeof CONTEXT_PROJECTION_VERSION;
  release_policy: 'not_required' | 'segment' | 'complete';
  context_build_status: 'not_required' | 'built' | 'over_budget' | 'failed';
  context_build_error_code: string | null;
  discourse_source_turn_ids: string[];
  legacy_bridge_policy_version: typeof LEGACY_BRIDGE_VERSION | null;
  legacy_bridge_source_turn_ids: string[];
  legacy_bridge_status: 'not_eligible' | 'captured' | 'used' | 'ambiguous' | 'invalid' | 'consumed' | 'invalidated';
  included_layers: ContextLayerName[];
  excluded_layers: ContextLayerName[];
  projected_slot_kinds: TaskSlotRef['slot'][];
  evicted_layers: ContextLayerName[];
  projection_reason_codes: string[];
  eviction_reason_codes: string[];
  token_estimate_by_layer: Partial<Record<ContextLayerName | 'instructions', number>>;
  evidence_ids: string[];
  retrieval_scores: Array<{ evidenceId: string; score: number }>;
  degraded_reason: string | null;
  packet_hmac_key_id: string | null;
  packet_hmac_sha256: string | null;
}

export interface CanonicalContextPacket {
  schemaVersion: 'context-packet-v1';
  currentInput: string;
  discourseContext: ContextChatMessage[];
  taskFrame: Record<string, unknown> | null;
  taskInputs: Array<Record<string, unknown>>;
  taskHistory: ContextChatMessage[];
  approvedEvidence: Array<Record<string, unknown>>;
}

export interface CanonicalGenerationRequest {
  schemaVersion: 'generation-request-v1';
  packetHmacKeyId: string;
  packetHmacSha256: string;
  generationMode: 'normal' | 'strict';
  overlay: { version: 'strict-overlay-v1'; content: string } | null;
  baseInstructions: string;
  messages: ContextChatMessage[];
  reasoningEffort: ContextReasoningEffort | null;
  store: false;
}

export interface GenerationRequestIntegrity {
  contextBuilderVersion: typeof CONTEXT_BUILDER_VERSION;
  packetHmacKeyId: string;
  packetHmacSha256: string;
  generationOverlayVersion: 'strict-overlay-v1' | null;
  generationRequestHmacSha256: string;
}
