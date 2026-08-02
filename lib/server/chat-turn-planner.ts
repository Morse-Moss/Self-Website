import type { SemanticIntent } from '../contracts/chat-context.ts';
import type { CompiledChatEvidenceCatalog } from '../contracts/chat-evidence-catalog.ts';
import type { NormalizedChatRequest } from '../contracts/chat-runtime.ts';
import {
  TURN_PLANNER_VERSION,
  TURN_PLAN_VERSION,
  type ConversationSessionSnapshot,
  type EvidenceRequirement,
  type TurnExecutor,
  type TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import {
  matchCatalogCapabilities,
} from './chat-evidence-catalog.ts';
import {
  resolveChatSemanticTurn,
  type ChatSemanticResolution,
} from './chat-semantic-resolver.ts';

export interface PlannedChatTurn {
  plan: TurnPlanV1;
  resolution: ChatSemanticResolution;
}

function assertNever(value: never): never {
  throw new Error(`TURN_PLAN_INTENT_UNSUPPORTED: ${String(value)}`);
}

function requestFromSnapshot(snapshot: ConversationSessionSnapshot): NormalizedChatRequest {
  return {
    message: snapshot.currentInput,
    workflow: snapshot.workflow,
    jobDescription: snapshot.workflow === 'jd_match' ? snapshot.currentInput : null,
    diagnosis: null,
    diagnosisStatus: null,
    mode: snapshot.mode,
    audienceIntent: snapshot.audienceIntent,
    conversationId: snapshot.conversationId,
    turnId: snapshot.interactionTurnId,
  };
}

function evidenceForIntent(
  intent: SemanticIntent,
  snapshot: ConversationSessionSnapshot,
  catalog: CompiledChatEvidenceCatalog,
  semantic: ReturnType<typeof resolveChatSemanticTurn>['resolved']['semantic'],
): EvidenceRequirement {
  switch (intent) {
    case 'identity_fact':
      return { kind: 'identity' };
    case 'project_catalog':
      return { kind: 'portfolio_full', rankForQuestion: false };
    case 'project_fit':
    case 'jd_match':
      return { kind: 'portfolio_full', rankForQuestion: true };
    case 'named_project_fact': {
      const projectRefs = semantic.projectRefs?.length
        ? [...semantic.projectRefs]
        : semantic.referent?.kind === 'project'
          ? [semantic.referent.ref]
          : [];
      const projectSlugs = catalog.projects
        .filter((entry) => projectRefs.includes(entry.slug))
        .map((entry) => entry.slug);
      return { kind: 'named_projects', projectSlugs };
    }
    case 'capability_fact': {
      const capabilityIds = [
        ...(semantic.referent?.kind === 'capability' ? [semantic.referent.ref] : []),
        ...matchCatalogCapabilities(snapshot.currentInput, catalog).map((entry) => entry.id),
      ].filter((id, index, ids) => ids.indexOf(id) === index);
      const includePortfolio = snapshot.workflow === 'jd_match'
        || snapshot.audienceIntent === 'recruiter'
        || snapshot.currentFrame?.taskKind === 'recruitment_evaluation'
        || snapshot.currentFrame?.taskKind === 'jd_match';
      return { kind: 'capabilities', capabilityIds, includePortfolio };
    }
    case 'external_current':
      return { kind: 'controlled_search' };
    case 'recruitment_intake':
    case 'unsupported_personal_history':
    case 'general_conversation':
    case 'clarify':
      return { kind: 'none' };
    default:
      return assertNever(intent);
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function executorForSafetyBoundary(
  safetyBoundary: PlannedChatTurn['resolution']['resolved']['legacyRoute']['safetyBoundary'],
): TurnExecutor {
  return safetyBoundary === null
    ? { kind: 'direct' }
    : { kind: 'safety_boundary', reason: safetyBoundary };
}

export function planChatTurn(
  snapshot: ConversationSessionSnapshot,
  catalog: CompiledChatEvidenceCatalog,
): TurnPlanV1 {
  return planChatTurnWithResolution(snapshot, catalog).plan;
}

export function planChatTurnWithResolution(
  snapshot: ConversationSessionSnapshot,
  catalog: CompiledChatEvidenceCatalog,
): PlannedChatTurn {
  const resolution = resolveChatSemanticTurn({
    request: requestFromSnapshot(snapshot),
    ledger: catalog,
    conversationId: snapshot.conversationId,
    currentUserMessageId: snapshot.currentUserMessageId,
    currentFrame: snapshot.currentFrame,
    discourseContext: snapshot.adjacentCompletedTurn,
    legacyBridge: snapshot.legacyBridge,
    taskIdFactory: () => snapshot.interactionTurnId,
  });
  const semantic = resolution.resolved.semantic;
  const evidence = evidenceForIntent(semantic.intent, snapshot, catalog, semantic);
  const taskId = resolution.candidateFrame?.taskId ?? null;

  const plan: TurnPlanV1 = deepFreeze({
    schemaVersion: TURN_PLAN_VERSION,
    plannerVersion: TURN_PLANNER_VERSION,
    conversationId: snapshot.conversationId,
    interactionTurnId: snapshot.interactionTurnId,
    currentUserMessageId: snapshot.currentUserMessageId,
    semantic,
    taskId,
    candidateFrame: resolution.candidateFrame,
    evidence,
    executor: executorForSafetyBoundary(resolution.resolved.legacyRoute.safetyBoundary),
    reasonCodes: [...semantic.reasonCodes],
  });
  return { plan, resolution };
}
