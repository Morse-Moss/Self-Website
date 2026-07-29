import type { SemanticIntent } from '../contracts/chat-context.ts';
import type { CompiledChatEvidenceCatalog } from '../contracts/chat-evidence-catalog.ts';
import type { NormalizedChatRequest } from '../contracts/chat-runtime.ts';
import {
  TURN_PLANNER_VERSION,
  TURN_PLAN_VERSION,
  type ConversationSessionSnapshot,
  type EvidenceRequirement,
  type TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import {
  matchCatalogCapabilities,
  matchCatalogProjects,
} from './chat-evidence-catalog.ts';
import { resolveChatSemanticTurn } from './chat-semantic-resolver.ts';

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
  referent: ReturnType<typeof resolveChatSemanticTurn>['resolved']['semantic']['referent'],
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
      const projectSlugs = referent?.kind === 'project'
        ? catalog.projects
            .filter((entry) => entry.slug === referent.ref)
            .map((entry) => entry.slug)
        : matchCatalogProjects(snapshot.currentInput, catalog);
      return { kind: 'named_projects', projectSlugs };
    }
    case 'capability_fact': {
      const capabilityIds = [
        ...(referent?.kind === 'capability' ? [referent.ref] : []),
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

export function planChatTurn(
  snapshot: ConversationSessionSnapshot,
  catalog: CompiledChatEvidenceCatalog,
): TurnPlanV1 {
  const resolution = resolveChatSemanticTurn({
    request: requestFromSnapshot(snapshot),
    ledger: catalog,
    conversationId: snapshot.conversationId,
    currentUserMessageId: snapshot.currentUserMessageId,
    currentFrame: snapshot.currentFrame,
    discourseContext: snapshot.adjacentCompletedTurn,
    taskIdFactory: () => snapshot.interactionTurnId,
  });
  const semantic = resolution.resolved.semantic;
  const evidence = evidenceForIntent(semantic.intent, snapshot, catalog, semantic.referent);
  const taskId = resolution.candidateFrame?.taskId ?? null;

  return deepFreeze({
    schemaVersion: TURN_PLAN_VERSION,
    plannerVersion: TURN_PLANNER_VERSION,
    conversationId: snapshot.conversationId,
    interactionTurnId: snapshot.interactionTurnId,
    currentUserMessageId: snapshot.currentUserMessageId,
    semantic,
    taskId,
    candidateFrame: resolution.candidateFrame,
    evidence,
    executor: { kind: 'direct' },
    reasonCodes: [...semantic.reasonCodes],
  });
}
