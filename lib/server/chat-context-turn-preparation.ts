import type { PoolClient } from 'pg';

import {
  CONTEXT_BUILDER_VERSION,
  CONTEXT_PIPELINE_VERSION,
  CONTEXT_PROJECTION_VERSION,
  LEGACY_BRIDGE_VERSION,
  type CanonicalAnswerSourceV2,
  type CandidateConversationTaskFrameV22,
  type ContextPacketManifest,
  type ContextProjection,
  type ConversationTaskFrameV22,
  type ResolvedChatTurn,
} from '../contracts/chat-context.ts';
import type { EvidenceBundle } from '../contracts/chat-evidence-catalog.ts';
import type {
  ConversationSessionSnapshot,
  TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import type { NormalizedChatRequest } from './chat-core.ts';
import { loadConversationSessionSnapshot } from './chat-conversation-session.ts';
import {
  buildCanonicalAnswerSourceV2,
  buildContextPacket,
  ContextPacketBuildError,
  type BuiltContextPacket,
  type ContextPacketDigestConfig,
} from './chat-context-packet.ts';
import { projectFinalContext } from './chat-context-projection.ts';
import {
  buildQaEvidence,
  planQaTurnWithResolution,
  type PlannedChatEvidence,
  type PlannedChatTurn,
} from './chat-qa-runtime.ts';
import { adaptV2Route } from './chat-route-adapter.ts';
import { RuntimePhaseError } from './chat-runtime-phase-error.ts';
import { loadCanonicalAnswerHistory } from './conversation-context-state.ts';
import type { KnowledgeSource } from './rag.ts';
import type { SearchResponse } from './search-provider.ts';

const CONTEXT_LAYERS = [
  'current_input',
  'discourse_context',
  'task_frame',
  'task_inputs',
  'task_history',
  'approved_evidence',
] as const;

export interface PreparedContextTurn {
  builtPacket: BuiltContextPacket | null;
  canonicalSource: CanonicalAnswerSourceV2 | null;
  candidateFrame: CandidateConversationTaskFrameV22 | null;
  contextScopeId: string;
  currentFrame: ConversationTaskFrameV22 | null;
  legacyBridgeResolution: 'consumed' | 'invalidated' | null;
  manifest: ContextPacketManifest;
  evidenceBundle: EvidenceBundle;
  plannedEvidence: PlannedChatEvidence;
  projection: ContextProjection;
  resolution: PlannedChatTurn['resolution'];
  sessionSnapshot: ConversationSessionSnapshot;
  turnPlan: TurnPlanV1;
  search: SearchResponse | undefined;
}

export interface ContextTerminalState {
  contextScopeId: string | null;
  manifest: ContextPacketManifest;
  resolved: ResolvedChatTurn | null;
}

export class ContextTurnPreparationError extends Error {
  readonly terminal: ContextTerminalState;
  readonly original: unknown;

  constructor(original: unknown, terminal: ContextTerminalState) {
    super('CONTEXT_PREPARATION_FAILED');
    this.name = 'ContextTurnPreparationError';
    this.original = original;
    this.terminal = terminal;
  }
}

export interface PrepareContextTurnInput {
  client: PoolClient;
  request: NormalizedChatRequest;
  turn: {
    conversationId: string;
    turnId: string;
    userMessageId: string | null;
    legacyBridgeCaptureStatus?: 'not_eligible' | 'invalid';
  };
  contextPacketDigest?: ContextPacketDigestConfig | null;
  additionalTrustedInstructions?: string;
  effectiveCurrentInput?: string;
  now: Date;
  signal?: AbortSignal;
  embedAll(queries: readonly string[], signal?: AbortSignal): Promise<readonly number[][]>;
  retrieveAll(embeddings: readonly number[][]): Promise<KnowledgeSource[]>;
  search(): Promise<SearchResponse | undefined>;
}

function contextManifest(input: {
  resolved: ResolvedChatTurn | null;
  contextScopeId: string;
  projection?: ContextProjection | null;
  bridgeStatus?: ContextPacketManifest['legacy_bridge_status'];
  bridgeTurnIds?: readonly string[];
  buildStatus: ContextPacketManifest['context_build_status'];
  errorCode?: string | null;
}): ContextPacketManifest {
  const projection = input.projection ?? null;
  const resolved = input.resolved;
  const bridgeTurnIds = [...(input.bridgeTurnIds ?? [])];
  return {
    pipeline_version: CONTEXT_PIPELINE_VERSION,
    semantic_intent: resolved?.semantic.intent ?? 'clarify',
    discourse_action: resolved?.semantic.discourseAction ?? 'one_shot',
    task_action: resolved?.semantic.taskAction ?? 'temporary',
    task_id: input.contextScopeId,
    task_state_version: projection?.frame?.taskStateVersion ?? 0,
    context_builder_version: CONTEXT_BUILDER_VERSION,
    projection_policy_version: CONTEXT_PROJECTION_VERSION,
    release_policy: resolved?.legacyRoute.safetyBoundary
      ? 'not_required'
      : resolved?.legacyRoute.release ?? 'not_required',
    context_build_status: input.buildStatus,
    context_build_error_code: input.errorCode ?? null,
    discourse_source_turn_ids: projection?.discourse ? [projection.discourse.turnId] : [],
    legacy_bridge_policy_version: bridgeTurnIds.length > 0 ? LEGACY_BRIDGE_VERSION : null,
    legacy_bridge_source_turn_ids: [...bridgeTurnIds],
    legacy_bridge_status: input.bridgeStatus ?? 'not_eligible',
    included_layers: projection?.includedLayers ?? [],
    excluded_layers: projection?.excludedLayers ?? [...CONTEXT_LAYERS],
    projected_slot_kinds: [...new Set(projection?.slots.map((slot) => slot.slot) ?? [])],
    evicted_layers: [],
    projection_reason_codes: projection?.reasonCodes ?? ['context_build_failed_before_projection'],
    eviction_reason_codes: [],
    token_estimate_by_layer: {},
    evidence_ids: [],
    retrieval_scores: [],
    degraded_reason: null,
    packet_hmac_key_id: null,
    packet_hmac_sha256: null,
  };
}

function dependencyErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function stableContextBuildError(error: unknown): {
  code: string;
  status: ContextPacketManifest['context_build_status'];
} {
  if (error instanceof ContextPacketBuildError) {
    return {
      code: error.code,
      status: error.code === 'CONTEXT_PACKET_OVER_BUDGET' ? 'over_budget' : 'failed',
    };
  }
  if (error instanceof RuntimePhaseError) {
    return { code: error.logCode, status: 'failed' };
  }
  const code = dependencyErrorCode(error);
  return {
    code: code && /^[A-Z0-9_]{1,80}$/u.test(code) ? code : 'CONTEXT_BUILD_FAILED',
    status: 'failed',
  };
}

function controlledSearchEvidence(
  response: SearchResponse | undefined,
  observedAt: Date,
): KnowledgeSource[] {
  if (response?.status !== 'completed') return [];
  return response.results.map((result, index) => ({
    chunkId: result.id,
    documentId: result.id,
    title: result.title,
    sourcePath: `controlled-search/${result.id}`,
    href: result.href,
    content: [
      `外部来源类型：${result.kind}`,
      `外部来源域名：${result.domain}`,
      `检索时间边界：${observedAt.toISOString()}`,
      result.snippet,
    ].join('\n'),
    score: Math.max(0, 1 - index / 100),
    projectSlug: null,
    topicIds: ['external-current'],
    evidenceLevel: 'direct',
  }));
}

function unavailableCapabilityIds(plannedEvidence: PlannedChatEvidence): string[] {
  return [...new Set(plannedEvidence.admissions.flatMap((item) => (
    item.level === 'unavailable' && item.capabilityId ? [item.capabilityId] : []
  )))].sort();
}

function searchBoundaryInstructions(
  resolved: ResolvedChatTurn,
  search: SearchResponse | undefined,
): string {
  if (resolved.semantic.intent !== 'external_current' || search?.status === 'completed') return '';
  return search?.status === 'failed'
    ? '联网搜索失败。本轮不得声称已经核验最新信息；只可说明当前无法完成外部时效核验。'
    : '本轮未执行联网搜索。本轮不得声称已经核验最新信息；只可说明当前无法完成外部时效核验。';
}

export async function prepareContextTurn(
  input: PrepareContextTurnInput,
): Promise<PreparedContextTurn> {
  const currentUserMessageId = input.turn.userMessageId;
  if (currentUserMessageId === null) throw new Error('CONTEXT_USER_MESSAGE_MISSING');
  let resolved: ResolvedChatTurn | null = null;
  let contextScopeId = input.turn.turnId;
  let projection: ContextProjection | null = null;
  let bridgeStatus: ContextPacketManifest['legacy_bridge_status'] = input.turn.legacyBridgeCaptureStatus
    ?? 'not_eligible';
  let bridgeTurnIds: string[] = [];

  try {
    if (input.turn.legacyBridgeCaptureStatus === 'invalid') {
      throw new RuntimePhaseError('CONVERSATION_INVALID', 'LEGACY_BRIDGE_INVALID');
    }
    const loadedSessionSnapshot = await loadConversationSessionSnapshot(input.client, {
      conversationId: input.turn.conversationId,
      interactionTurnId: input.turn.turnId,
      currentUserMessageId,
      request: input.request,
    });
    const planningSessionSnapshot: ConversationSessionSnapshot = input.effectiveCurrentInput
      ? Object.freeze({
          ...loadedSessionSnapshot,
          currentInput: input.effectiveCurrentInput,
        })
      : loadedSessionSnapshot;
    const currentFrame = planningSessionSnapshot.currentFrame;
    const discourse = planningSessionSnapshot.adjacentCompletedTurn;
    const legacyBridge = planningSessionSnapshot.legacyBridge;
    bridgeTurnIds = legacyBridge.map((turn) => turn.turnId);
    const planning = planQaTurnWithResolution(planningSessionSnapshot);
    const { resolution } = planning;
    resolved = resolution.resolved;
    bridgeStatus = resolution.legacyBridgeStatus;
    const isolatedTurn = resolved.semantic.taskAction === 'temporary'
      || resolved.semantic.discourseAction === 'one_shot';
    contextScopeId = isolatedTurn
      ? input.turn.turnId
      : resolution.candidateFrame?.taskId
        ?? currentFrame?.taskId
        ?? input.turn.turnId;
    const loadedContextScopeId = currentFrame?.taskId ?? discourse?.contextScopeId ?? null;
    const history = resolution.candidateFrame || currentFrame
      ? contextScopeId === loadedContextScopeId
        ? [...planningSessionSnapshot.completedHistory]
        : await loadCanonicalAnswerHistory(input.client, {
            conversationId: input.turn.conversationId,
            ownerPipeline: 'context_packet_v22',
            contextScopeId,
            includeConversation: false,
          })
      : [];
    const sessionSnapshot: ConversationSessionSnapshot = Object.freeze({
      ...planningSessionSnapshot,
      completedHistory: Object.freeze([...history]),
    });
    const turnPlan = planning.plan;
    let evidenceBundle: EvidenceBundle = turnPlan.executor.kind === 'safety_boundary'
      ? {
          catalogVersion: 2,
          approved: [],
          admissions: [],
          relevance: [],
          unavailableCapabilityIds: [],
          degradedReason: null,
        }
      : await buildQaEvidence({
          plan: turnPlan,
          session: sessionSnapshot,
          retrieval: {
            embedAll: (queries) => input.embedAll(queries, input.signal),
            retrieveAll: input.retrieveAll,
          },
        });
    const search = resolved.semantic.intent === 'external_current'
      ? await input.search()
      : undefined;
    const searchEvidence = controlledSearchEvidence(search, input.now);
    if (searchEvidence.length > 0) {
      evidenceBundle = {
        ...evidenceBundle,
        approved: [...evidenceBundle.approved, ...searchEvidence],
        admissions: [
          ...evidenceBundle.admissions,
          ...searchEvidence.map((source) => ({
            evidenceId: source.chunkId,
            level: 'direct' as const,
            projectSlug: null,
            capabilityId: null,
          })),
        ],
        relevance: [
          ...evidenceBundle.relevance,
          ...searchEvidence.map((source) => ({
            evidenceId: source.chunkId,
            score: source.score,
          })),
        ],
      };
    }
    const plannedEvidence: PlannedChatEvidence = {
      knowledge: [...evidenceBundle.approved],
      admissions: [...evidenceBundle.admissions],
      retrievalScores: evidenceBundle.relevance.flatMap((item) => (
        item.score === null ? [] : [{ evidenceId: item.evidenceId, score: item.score }]
      )),
      degradedReason: evidenceBundle.degradedReason,
    };
    projection = projectFinalContext({
      resolved,
      currentUserMessageId,
      discourse,
      frame: resolution.candidateFrame ?? currentFrame,
      history,
      approvedEvidence: [...evidenceBundle.approved],
    });
    const legacyBridgeResolution = bridgeTurnIds.length === 0
      ? null
      : resolution.legacyBridgeStatus === 'used'
        ? 'consumed'
        : resolved.semantic.taskAction === 'switch'
          || resolved.semantic.discourseAction === 'new_task'
          ? 'invalidated'
          : null;
    if (turnPlan.executor.kind === 'safety_boundary') {
      return {
        builtPacket: null,
        canonicalSource: null,
        candidateFrame: resolution.candidateFrame,
        contextScopeId,
        currentFrame,
        legacyBridgeResolution,
        manifest: contextManifest({
          resolved,
          contextScopeId,
          projection,
          bridgeStatus,
          bridgeTurnIds,
          buildStatus: 'not_required',
        }),
        evidenceBundle,
        plannedEvidence,
        projection,
        resolution,
        sessionSnapshot,
        search,
        turnPlan,
      };
    }

    const digest = input.contextPacketDigest;
    if (!digest) throw new Error('CONTEXT_PACKET_DIGEST_CONFIG_INVALID');
    const route = adaptV2Route(resolved.legacyRoute);
    const builtPacket = buildContextPacket({
      resolved,
      currentInput: sessionSnapshot.currentInput,
      currentUserMessageId,
      projection,
      evidenceBundle,
      turnPlan,
      answerValidation: null,
      digestKey: digest.key,
      digestKeyId: digest.keyId,
      reasoningEffort: route.reasoningEffort ?? null,
      contextScopeId,
      legacyBridge: bridgeTurnIds.length > 0 ? {
        policyVersion: LEGACY_BRIDGE_VERSION,
        sourceTurnIds: bridgeTurnIds,
        status: bridgeStatus,
      } : null,
      degradedReason: plannedEvidence.degradedReason,
      capabilityEvidenceBoundaries: unavailableCapabilityIds(plannedEvidence),
      additionalTrustedInstructions: [
        input.additionalTrustedInstructions,
        searchBoundaryInstructions(resolved, search),
      ].filter(Boolean).join('\n\n'),
    });
    const canonicalSource = buildCanonicalAnswerSourceV2({
      ownerPipeline: 'context_packet_v22',
      conversationId: input.turn.conversationId,
      interactionTurnId: input.turn.turnId,
      contextScopeId,
      currentUserMessageId,
      currentInput: sessionSnapshot.currentInput,
      trustedInstructions: builtPacket.normal.request.baseInstructions,
      turnPlanManifest: builtPacket.manifest.turn_plan,
      taskFrame: builtPacket.packet.taskFrame,
      taskInputs: builtPacket.packet.taskInputs,
      approvedEvidence: builtPacket.packet.approvedEvidence,
      completeHistory: history,
      reasoningEffort: route.reasoningEffort ?? null,
      releasePolicy: resolved.legacyRoute.release,
    });
    return {
      builtPacket,
      canonicalSource,
      candidateFrame: resolution.candidateFrame,
      contextScopeId,
      currentFrame,
      legacyBridgeResolution,
      manifest: builtPacket.manifest,
      evidenceBundle,
      plannedEvidence,
      projection,
      resolution,
      sessionSnapshot,
      search,
      turnPlan,
    };
  } catch (error) {
    const failure = stableContextBuildError(error);
    throw new ContextTurnPreparationError(error, {
      contextScopeId,
      resolved,
      manifest: contextManifest({
        resolved,
        contextScopeId,
        projection,
        bridgeStatus,
        bridgeTurnIds,
        buildStatus: failure.status,
        errorCode: failure.code,
      }),
    });
  }
}
