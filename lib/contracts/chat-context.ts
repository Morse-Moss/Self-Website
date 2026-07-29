import type { ChatRouteDecision, KnowledgeSource } from './chat-runtime.ts';

export type EvidenceRequirementKind =
  | 'none'
  | 'identity'
  | 'portfolio_full'
  | 'named_projects'
  | 'capabilities'
  | 'controlled_search';

export type AnswerValidationIssueCode =
  | 'missing_evidence_coverage'
  | 'invalid_citation'
  | 'unsupported_capability_claim'
  | 'private_data_leak'
  | 'secret_leak';

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
export const CANONICAL_ANSWER_SOURCE_VERSION = 'canonical-answer-source-v2' as const;
export const TASK_HISTORY_SUMMARY_INSTRUCTION_VERSION = 'task-history-summary-v1' as const;

export type HistoryCompactionPipeline =
  | 'legacy_v1'
  | 'legacy_v2'
  | 'context_packet_v22';

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

export interface CanonicalAnswerSourceV2 {
  schemaVersion: typeof CANONICAL_ANSWER_SOURCE_VERSION;
  ownerPipeline: HistoryCompactionPipeline;
  conversationId: string;
  interactionTurnId: string;
  contextScopeId: string | null;
  currentUserMessageId: string;
  currentInput: string;
  trustedInstructions: string;
  taskFrame: Record<string, unknown> | null;
  taskInputs: Array<Record<string, unknown>>;
  approvedEvidence: Array<Record<string, unknown>>;
  completeHistory: CompletedContextTurn[];
  reasoningEffort: ContextReasoningEffort | null;
  releasePolicy: 'segment' | 'complete';
}

export interface GenerationTargetBindingV2 {
  configDigestVersion: 1 | 2;
  configDigest: string;
  modelId: string;
  protocol: 'responses' | 'chat_completions';
  contextWindowTokens: number | null;
  maxOutputTokens: number | null;
  reasoningEffort: ContextReasoningEffort | null;
}

export interface TaskHistorySummaryLayer {
  layer: 'task_history_summary';
  text: string;
  sourceTurnIds: readonly string[];
  sourceTurnSha256: string;
  instructionVersion: typeof TASK_HISTORY_SUMMARY_INSTRUCTION_VERSION;
}

export interface GenerationVariantV2 {
  id: string;
  revision: number;
  trigger: 'initial' | 'numeric_preflight' | 'provider_numeric_overflow';
  target: GenerationTargetBindingV2;
}

export interface CanonicalContextPacketV2 {
  schemaVersion: 'context-packet-v2';
  sourceSchemaVersion: typeof CANONICAL_ANSWER_SOURCE_VERSION;
  ownerPipeline: HistoryCompactionPipeline;
  conversationId: string;
  interactionTurnId: string;
  contextScopeId: string | null;
  currentUserMessageId: string;
  variant: GenerationVariantV2;
  protectedLayers: {
    currentInput: string;
    trustedInstructions: string;
    taskFrame: Readonly<Record<string, unknown>> | null;
    taskInputs: readonly Readonly<Record<string, unknown>>[];
    approvedEvidence: readonly Readonly<Record<string, unknown>>[];
  };
  historySummary: TaskHistorySummaryLayer | null;
  rawHistory: readonly CompletedContextTurn[];
}

export interface CanonicalGenerationRequestV2 {
  schemaVersion: 'generation-request-v2';
  variant: GenerationVariantV2;
  packetHmacKeyId: string;
  packetHmacSha256: string;
  instructions: string;
  messages: readonly ContextChatMessage[];
  reasoningEffort: ContextReasoningEffort | null;
  maxOutputTokens: number | null;
  outboundBody: Readonly<Record<string, unknown>>;
  store: false;
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
  retrieval_scores: Array<{ evidenceId: string; score: number | null }>;
  degraded_reason: string | null;
  turn_plan?: TurnPlanManifest;
  answer_validation?: AnswerValidationManifest;
  packet_hmac_key_id: string | null;
  packet_hmac_sha256: string | null;
}

export interface TurnPlanManifest {
  schema_version: 'turn-plan-v1';
  planner_version: 'deterministic-turn-planner-v1';
  evidence_kind: EvidenceRequirementKind;
  executor_kind: 'direct';
  project_ids: string[];
  capability_ids: string[];
}

export interface AnswerValidationManifest {
  verdict: 'not_run' | 'pass' | 'warn' | 'block';
  issue_codes: AnswerValidationIssueCode[];
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

export interface GenerationRequestIntegrityV1 {
  contextBuilderVersion: typeof CONTEXT_BUILDER_VERSION;
  packetHmacKeyId: string;
  packetHmacSha256: string;
  generationOverlayVersion: 'strict-overlay-v1' | null;
  generationRequestHmacSha256: string;
}

export interface GenerationRequestIntegrityV2 {
  version: 2;
  contextBuilderVersion: string;
  generationVariantId: string;
  generationVariantRevision: number;
  target: GenerationTargetBindingV2;
  packetHmacKeyId: string;
  packetHmacSha256: string;
  generationRequestHmacSha256: string;
}

export type GenerationRequestIntegrity =
  | GenerationRequestIntegrityV1
  | GenerationRequestIntegrityV2;
