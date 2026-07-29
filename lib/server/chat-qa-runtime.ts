import type { EvidenceBundle } from '../contracts/chat-evidence-catalog.ts';
import type {
  AnswerCandidate,
  AnswerValidationResult,
  ConversationSessionSnapshot,
  TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import { validateAnswer as validateCandidateAnswer } from './chat-answer-validator.ts';
import { compiledChatEvidenceCatalog } from './chat-evidence-catalog.ts';
import {
  prepareTargetContext,
  type PreparedTargetContext,
} from './chat-context-coordinator.ts';
import {
  planChatEvidence,
  type PlanEvidenceBundleInput,
  type PlannedChatEvidence,
} from './chat-evidence-planner.ts';
import {
  planChatTurn,
  planChatTurnWithResolution,
  type PlannedChatTurn,
} from './chat-turn-planner.ts';

export type { PlannedChatEvidence, PreparedTargetContext };
export type { PlannedChatTurn };

export const qaCapabilityLedger = compiledChatEvidenceCatalog;

export function planQaTurn(session: ConversationSessionSnapshot): TurnPlanV1 {
  return planChatTurn(session, compiledChatEvidenceCatalog);
}

export function planQaTurnWithResolution(
  session: ConversationSessionSnapshot,
): PlannedChatTurn {
  return planChatTurnWithResolution(session, compiledChatEvidenceCatalog);
}

export function buildQaEvidence(
  input: Omit<PlanEvidenceBundleInput, 'catalog'>,
): Promise<EvidenceBundle> {
  return planChatEvidence({ ...input, catalog: compiledChatEvidenceCatalog });
}

export const prepareQaTargetContext: typeof prepareTargetContext = prepareTargetContext;

export interface RunQaTurnInput {
  privacyCanaries: readonly string[];
  signal?: AbortSignal;
}

export interface QaRuntimeDependencies<Context = unknown> {
  loadSession(input: RunQaTurnInput): Promise<ConversationSessionSnapshot>;
  planTurn(session: ConversationSessionSnapshot): TurnPlanV1;
  buildEvidence(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
  }): Promise<EvidenceBundle>;
  buildContext(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
    evidence: EvidenceBundle;
  }): Promise<Context>;
  executeDirect(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
    evidence: EvidenceBundle;
    context: Context;
  }, signal: AbortSignal): Promise<AnswerCandidate>;
  validateAnswer?(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
    evidence: EvidenceBundle;
    context: Context;
    candidate: AnswerCandidate;
    privacyCanaries: readonly string[];
  }): AnswerValidationResult;
  commitSuccess(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
    evidence: EvidenceBundle;
    context: Context;
    candidate: AnswerCandidate;
    validation: AnswerValidationResult;
  }): Promise<void>;
  compensateBlock(input: {
    session: ConversationSessionSnapshot;
    plan: TurnPlanV1;
    evidence: EvidenceBundle;
    context: Context;
    validation: AnswerValidationResult;
  }): Promise<void>;
}

export interface CommittedQaTurn<Context = unknown> {
  committed: true;
  publicAnswer: string;
  session: ConversationSessionSnapshot;
  plan: TurnPlanV1;
  evidence: EvidenceBundle;
  context: Context;
  candidate: AnswerCandidate;
  validation: AnswerValidationResult;
}

export class QaAnswerBlockedError extends Error {
  readonly issueCodes: readonly string[];

  constructor(validation: AnswerValidationResult) {
    super('QA_ANSWER_BLOCKED');
    this.name = 'QaAnswerBlockedError';
    this.issueCodes = validation.issues.map((issue) => issue.code);
  }
}

export async function runQaTurn<Context>(
  input: RunQaTurnInput,
  dependencies: QaRuntimeDependencies<Context>,
): Promise<CommittedQaTurn<Context>> {
  const signal = input.signal ?? new AbortController().signal;
  if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  const session = await dependencies.loadSession(input);
  const plan = dependencies.planTurn(session);
  const evidence = await dependencies.buildEvidence({ session, plan });
  const context = await dependencies.buildContext({ session, plan, evidence });
  const candidate = await dependencies.executeDirect({ session, plan, evidence, context }, signal);
  const validationInput = {
    session,
    plan,
    evidence,
    context,
    candidate,
    privacyCanaries: input.privacyCanaries,
  };
  const validation = dependencies.validateAnswer
    ? dependencies.validateAnswer(validationInput)
    : validateCandidateAnswer({ plan, evidence, candidate, privacyCanaries: input.privacyCanaries });
  if (validation.verdict === 'block') {
    await dependencies.compensateBlock({ session, plan, evidence, context, validation });
    throw new QaAnswerBlockedError(validation);
  }
  await dependencies.commitSuccess({ session, plan, evidence, context, candidate, validation });
  return {
    committed: true,
    publicAnswer: candidate.text,
    session,
    plan,
    evidence,
    context,
    candidate,
    validation,
  };
}
