import { createHash, randomUUID } from 'node:crypto';

import type {
  CandidateConversationTaskFrameV22,
  CompletedContextTurn,
  ContextTaskAction,
  ContextWaitingFor,
  ConversationTaskFrameV22,
  DiscourseAction,
  EvidencePlanCode,
  ResolvedChatTurn,
  ResolvedTaskSlotRef,
  SemanticIntent,
  SemanticTurnDecision,
} from '../contracts/chat-context.ts';
import type { ChatEvidenceClass } from '../contracts/chat.ts';
import type {
  ChatRouteDecision,
  NormalizedChatRequest,
} from '../contracts/chat-runtime.ts';
import {
  assessCapabilities,
  type CapabilityLedger,
} from './capability-evidence.ts';
import {
  isGenericJdDefinitionQuestion,
  looksLikeRecruitmentEvaluationQuestion,
  looksLikeRecruitmentJobDescription,
} from './chat-message-signals.ts';
import {
  matchCatalogProjects,
} from './chat-evidence-catalog.ts';
import { routeChatTurn, type RouteAnchor } from './chat-route-policy.ts';

const RECRUITMENT_CLARIFY_REPLY = '请补充要匹配的公司或岗位；有其中一项，我就能先基于公开项目证据继续。';
const RELEVANCE_CLARIFY_REPLY = '你想把相关项目与哪家公司或岗位比较？';

export interface ResolveChatSemanticTurnInput {
  request: NormalizedChatRequest;
  ledger: CapabilityLedger;
  conversationId: string;
  currentUserMessageId: string;
  currentFrame?: ConversationTaskFrameV22 | null;
  discourseContext?: CompletedContextTurn | null;
  legacyBridge?: readonly CompletedContextTurn[];
  taskIdFactory?: () => string;
}

export interface ChatSemanticResolution {
  resolved: ResolvedChatTurn;
  candidateFrame: CandidateConversationTaskFrameV22 | null;
  legacyBridgeStatus: 'not_eligible' | 'captured' | 'used' | 'ambiguous' | 'invalid';
  legacyBridgeSourceTurnIds: string[];
}

interface SlotCapture {
  kind: ResolvedTaskSlotRef['slot'];
  start: number;
  end: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function slotFromCapture(
  message: string,
  capture: SlotCapture,
  sourceMessageId: string,
): ResolvedTaskSlotRef {
  const text = message.slice(capture.start, capture.end);
  return {
    slot: capture.kind,
    sourceMessageId,
    startUtf16: capture.start,
    endUtf16: capture.end,
    contentSha256: sha256(text),
    extractorVersion: 'recruitment-slots-v1',
    ordinal: 0,
    text,
  };
}

function captureGroup(
  message: string,
  expression: RegExp,
  kind: SlotCapture['kind'],
): SlotCapture | null {
  const match = expression.exec(message);
  const raw = match?.[1];
  if (!match || !raw) return null;
  const leading = raw.search(/\S/u);
  const value = raw.trim();
  if (!value) return null;
  const relative = match[0].indexOf(raw) + Math.max(0, leading);
  const start = match.index + relative;
  return { kind, start, end: start + value.length };
}

function extractSlotCaptures(
  message: string,
  options: { includeJobDescription: boolean; wholeJd: boolean },
): SlotCapture[] {
  const captures: SlotCapture[] = [];
  const company = captureGroup(
    message,
    /(?:公司|企业|雇主)\s*不是[^，,。；;\n]{1,80}[，,]\s*(?:而?是|改成|换成)?\s*([^，,。；;\n]{1,80})/iu,
    'company',
  ) ?? captureGroup(
    message,
    /(?:公司|企业|雇主)\s*(?:是|为|叫|[:：])\s*([^，,。；;\n]{1,80})/iu,
    'company',
  );
  if (company) captures.push(company);

  const role = captureGroup(
    message,
    /(?:岗位|职位|角色)\s*(?:不是[^，,。；;\n]{1,80}[，,]\s*(?:而?是|改成|换成)|是|为|叫|[:：])?\s*([^，,。；;\n]{1,80}?(?:(?:工程师|产品经理|架构师|运营|设计师|负责人|专家)(?=$|[\s,，。;；:：])|(?:developer|engineer|product\s+manager)\b))/iu,
    'role',
  ) ?? captureGroup(
    message,
    /((?:[A-Za-z][A-Za-z +#./-]*|[\p{Script=Han}A-Za-z +#./-]{0,30})(?:(?:工程师|产品经理|架构师|运营|设计师|负责人|专家)(?=$|[\s,，。;；:：])|(?:developer|engineer|product\s+manager)\b))/iu,
    'role',
  );
  if (role) captures.push(role);

  if (options.includeJobDescription) {
    if (options.wholeJd) {
      const start = message.search(/\S/u);
      const text = message.trim();
      if (start >= 0 && text) {
        captures.push({ kind: 'job_description', start, end: start + text.length });
      }
    } else {
      const explicit = captureGroup(
        message,
        /(?:\bJD\b|岗位职责|工作职责|职位描述|职责描述|任职要求|岗位要求|职位要求|资格要求|任职资格)\s*[:：]\s*([\s\S]+)$/iu,
        'job_description',
      );
      if (explicit) {
        captures.push(explicit);
      } else {
        const start = message.search(/\S/u);
        const text = message.trim();
        if (start >= 0 && text) {
          captures.push({ kind: 'job_description', start, end: start + text.length });
        }
      }
    }
  }
  return captures;
}

function previousAnchor(turn: CompletedContextTurn | null | undefined): RouteAnchor | null {
  if (!turn) return null;
  return {
    turnId: turn.turnId,
    routeKind: 'conversation',
    reasonCode: 'context_packet_discourse',
    topicKind: 'none',
    topicRef: null,
    answer: turn.assistant.text,
    question: turn.user.text,
    previousTurnCompleted: true,
  };
}

function releaseForIntent(intent: SemanticIntent): 'segment' | 'complete' {
  return [
    'project_catalog',
    'project_fit',
    'named_project_fact',
    'capability_fact',
    'jd_match',
    'unsupported_personal_history',
    'external_current',
  ].includes(intent) ? 'complete' : 'segment';
}

function evidencePlanForIntent(intent: SemanticIntent): EvidencePlanCode[] {
  switch (intent) {
    case 'identity_fact': return ['identity_card'];
    case 'project_catalog': return ['approved_project_catalog'];
    case 'project_fit':
    case 'jd_match': return ['ranked_project_fit'];
    case 'named_project_fact': return ['named_approved_project'];
    case 'capability_fact': return ['capability_ledger'];
    case 'external_current': return ['controlled_search'];
    default: return ['none'];
  }
}

function legacyRouteForSemantic(input: {
  intent: SemanticIntent;
  reasonCode: string;
  inheritedFromTurnId?: string | null;
  deterministicReply?: string | null;
  referent?: SemanticTurnDecision['referent'];
  capabilityEvidence?: ChatEvidenceClass;
}): ChatRouteDecision {
  const common = {
    reasonCode: input.reasonCode,
    inheritedFromTurnId: input.inheritedFromTurnId ?? null,
    release: releaseForIntent(input.intent),
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: input.deterministicReply ?? null,
  } as const;
  switch (input.intent) {
    case 'identity_fact':
      return { ...common, routeKind: 'identity', topicKind: 'none', topicRef: null, evidenceClass: 'identity' };
    case 'project_catalog':
      return { ...common, routeKind: 'grounded', topicKind: 'project', topicRef: null, evidenceClass: 'direct' };
    case 'project_fit':
      return { ...common, routeKind: 'grounded', topicKind: 'project', topicRef: null, evidenceClass: 'mixed', requiresEmbedding: true };
    case 'named_project_fact':
      return { ...common, routeKind: 'grounded', topicKind: 'project', topicRef: input.referent?.ref ?? null, evidenceClass: 'direct', requiresEmbedding: true };
    case 'capability_fact':
      return { ...common, routeKind: 'personal_fact', topicKind: 'capability', topicRef: input.referent?.ref ?? null, evidenceClass: input.capabilityEvidence ?? 'unavailable' };
    case 'jd_match':
      return { ...common, routeKind: 'jd', topicKind: 'jd', topicRef: 'jd', evidenceClass: 'mixed', requiresEmbedding: true };
    case 'recruitment_intake':
      return { ...common, routeKind: 'jd_intake', topicKind: 'none', topicRef: null, evidenceClass: 'none' };
    case 'unsupported_personal_history':
      return { ...common, routeKind: 'personal_fact', topicKind: 'none', topicRef: null, evidenceClass: 'unavailable' };
    case 'external_current':
      return { ...common, routeKind: 'external_current', topicKind: 'external', topicRef: null, evidenceClass: 'web', requiresSearch: true };
    case 'clarify':
      return { ...common, routeKind: 'clarify', topicKind: 'none', topicRef: null, evidenceClass: 'none' };
    default:
      return { ...common, routeKind: 'conversation', topicKind: 'none', topicRef: null, evidenceClass: 'none' };
  }
}

function isActiveRecruitmentFrame(frame: ConversationTaskFrameV22 | null): boolean {
  return Boolean(frame
    && frame.status !== 'completed'
    && (frame.taskKind === 'recruitment_evaluation' || frame.taskKind === 'jd_match'));
}

function isProjectCatalog(message: string): boolean {
  return /(?:你|morse|摩斯).{0,8}(?:做过|有|完成过|负责过)?(?:的)?(?:哪些|哪一些|什么)(?:其他|别的)?(?:项目|作品)|(?:项目|作品).{0,6}(?:有哪些|有哪一些)/iu.test(message)
    && !/(?:相关|匹配|适合|证明|经验|最合适)/iu.test(message);
}

function isProjectFit(message: string): boolean {
  return /(?:相关|匹配|适合|胜任|证明|最合适|最相关).{0,18}(?:项目|项目经验)|(?:项目|项目经验).{0,18}(?:相关|匹配|适合|证明)|有什么相关项目经验/iu.test(message);
}

function isPersonalHistoryQuestion(message: string): boolean {
  return /(?:你|morse|摩斯).{0,16}(?:做过|负责过|参与过|有).{0,24}(?:系统|项目|经验|经历)/iu.test(message);
}

function isBareRecheck(message: string): boolean {
  const trimmed = message.trim().replace(/[。！!？?]+$/gu, '');
  return /^(?:你)?(?:再|重新)(?:去)?(?:查|找|核对|确认)(?:一?下|一遍)?$/u.test(trimmed);
}

function isRecruitmentContinuationCue(message: string): boolean {
  const trimmed = message.trim().replace(/[。！!？?]+$/gu, '');
  if (trimmed.length > 30) return false;
  return /^(?:这些|那些|这个|那个)(?:项目|证据|匹配|优势|风险|缺口|能力|经历|内容)?(?:呢|怎么样|再(?:展开|说明|分析)(?:一下)?|继续(?:说|分析)?)?$/u.test(trimmed)
    || /^(?:继续|还有|然后)(?:呢|说|分析|展开|补充)?(?:一下)?$/u.test(trimmed);
}

function isCorrection(message: string): boolean {
  return /(?:不是|不对|改成|更正|纠正)/iu.test(message);
}

function isSwitch(message: string): boolean {
  const recruitmentTarget = '(?:公司|企业|雇主|岗位|职位|角色|JD|职位描述|招聘(?:任务|评估)?)';
  const switchTarget = `${recruitmentTarget}(?=$|[\\s:：，,。！？!?])`;
  const switchQualifier = '(?:(?:新|新的|另一个|另一份|另一家|其他|这个|那个)\\s*)?';
  const commandPrefix = '(?:请|现在|接下来|我想|我们(?:来)?|帮我)?\\s*(?:把)?';
  return new RegExp(
    `^${commandPrefix}(?:换个|换一(?:个|份|家)?|换成|换到|改看|重新看|切换到?|另一个|另一份|另一家)\\s*${switchQualifier}${switchTarget}`
      + `|^${commandPrefix}${recruitmentTarget}\\s*(?:换成|改成|切换到?|重新看)`
      + '|^(?:请)?(?:开始|创建|切换到?)?新任务[。！!？?]*$'
      + '|^(?:请)?忽略(?:以前|之前)(?:的)?内容[。！!？?]*$',
    'iu',
  ).test(message.trim());
}

function isCompletion(message: string): boolean {
  return /(?:最终结论|最后答复|结束(?:这个|当前)?(?:任务|话题)?|可以结束|就到这里)/iu.test(message);
}

function clearKinds(message: string): Set<ResolvedTaskSlotRef['slot']> {
  const result = new Set<ResolvedTaskSlotRef['slot']>();
  if (!/(?:清除|清空|忽略|不要|删除|忘掉).{0,16}(?:前面|之前|已有|旧|的)?/iu.test(message)) return result;
  if (/公司|企业|雇主/iu.test(message)) result.add('company');
  if (/岗位|职位|角色/iu.test(message)) result.add('role');
  if (/\bJD\b|职责|要求|职位描述/iu.test(message)) result.add('job_description');
  return result;
}

function normalizeSlots(slots: ResolvedTaskSlotRef[]): ResolvedTaskSlotRef[] {
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

function reconstructLegacyRecruitmentFrame(input: {
  conversationId: string;
  turns: readonly CompletedContextTurn[];
  taskIdFactory: () => string;
}): { frame: ConversationTaskFrameV22 | null; ambiguous: boolean } {
  if (input.turns.length === 0) return { frame: null, ambiguous: false };
  const ordered = [...input.turns].sort((left, right) => (
    left.completedAt.getTime() - right.completedAt.getTime()
    || (BigInt(left.user.id) < BigInt(right.user.id) ? -1 : 1)
  ));
  let slots: ResolvedTaskSlotRef[] = [];
  let taskStartedMessageId: string | null = null;
  let ambiguous = false;
  for (const turn of ordered) {
    const message = turn.user.text;
    const switchBoundary = isSwitch(message);
    const correctionBoundary = isCorrection(message);
    if (switchBoundary) {
      slots = [];
      taskStartedMessageId = turn.user.id;
    }
    const hasRecruitmentSlots = slots.some(
      (candidate) => candidate.slot === 'company' || candidate.slot === 'role',
    );
    const includeJd = looksLikeRecruitmentJobDescription(message, {
      hasActiveRecruitmentFrame: hasRecruitmentSlots,
    });
    const extracted = extractSlotCaptures(message, {
      includeJobDescription: includeJd,
      wholeJd: includeJd,
    }).map((capture) => slotFromCapture(message, capture, turn.user.id));
    if (extracted.length > 0 && !taskStartedMessageId) taskStartedMessageId = turn.user.id;
    for (const candidate of extracted) {
      if (candidate.slot === 'job_description') {
        slots.push(candidate);
      } else {
        const existing = slots.find((slot) => slot.slot === candidate.slot);
        if (existing
          && existing.contentSha256 !== candidate.contentSha256
          && !switchBoundary
          && !correctionBoundary) {
          ambiguous = true;
          continue;
        }
        slots = slots.filter((existing) => existing.slot !== candidate.slot);
        slots.push(candidate);
      }
    }
    slots = normalizeSlots(slots);
  }
  if (ambiguous) return { frame: null, ambiguous: true };
  if (!taskStartedMessageId || slots.length === 0) return { frame: null, ambiguous: false };
  const latest = ordered.at(-1)!;
  return {
    ambiguous: false,
    frame: {
      conversationId: input.conversationId,
      taskId: input.taskIdFactory(),
      taskKind: 'recruitment_evaluation',
      subjectKind: 'morse',
      subjectRef: 'recruitment',
      evidenceFocus: { topicKind: 'none', topicRef: null },
      status: 'active',
      closedReason: null,
      waitingFor: [],
      taskStartedMessageId,
      lastSuccessfulMessageId: latest.assistant.id,
      version: 0,
      updatedByMessageId: latest.user.id,
      createdAt: ordered[0].completedAt,
      updatedAt: latest.completedAt,
      slots,
    },
  };
}

function buildCandidateFrame(input: {
  conversationId: string;
  currentUserMessageId: string;
  currentFrame: ConversationTaskFrameV22 | null;
  taskAction: ContextTaskAction;
  intent: SemanticIntent;
  message: string;
  workflow: string | undefined;
  taskIdFactory: () => string;
  clear: Set<ResolvedTaskSlotRef['slot']>;
  includeJd: boolean;
  extractSlots: boolean;
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
  const extracted = input.extractSlots
    ? extractSlotCaptures(input.message, {
        includeJobDescription: input.includeJd,
        wholeJd: input.includeJd,
      }).map((capture) => slotFromCapture(input.message, capture, input.currentUserMessageId))
    : [];
  for (const candidate of extracted) {
    if (candidate.slot === 'job_description') {
      if (replaceWholeJd) slots = slots.filter((existing) => existing.slot !== 'job_description');
      slots.push(candidate);
    } else {
      slots = slots.filter((existing) => existing.slot !== candidate.slot);
      slots.push(candidate);
    }
  }
  slots = normalizeSlots(slots);

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
    expectedVersion: reuse ? input.currentFrame!.version : 0,
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

export function resolveChatSemanticTurn(input: ResolveChatSemanticTurnInput): ChatSemanticResolution {
  const message = input.request.message.trim();
  const taskIdFactory = input.taskIdFactory ?? randomUUID;
  const legacyBridge = input.legacyBridge ?? [];
  const bridgeReconstruction = input.currentFrame
    ? { frame: null, ambiguous: false }
    : reconstructLegacyRecruitmentFrame({
        conversationId: input.conversationId,
        turns: legacyBridge,
        taskIdFactory,
      });
  const reconstructedBridgeFrame = bridgeReconstruction.frame;
  const currentFrame = input.currentFrame ?? reconstructedBridgeFrame;
  const activeRecruitment = isActiveRecruitmentFrame(currentFrame);
  const latestLegacyTurn = [...legacyBridge].sort((left, right) => (
    left.completedAt.getTime() - right.completedAt.getTime()
    || (BigInt(left.user.id) < BigInt(right.user.id) ? -1 : 1)
  )).at(-1) ?? null;
  const adjacentReconstructedRecruitment = Boolean(
    reconstructedBridgeFrame
    && latestLegacyTurn
    && !input.discourseContext
    && (
      reconstructedBridgeFrame.slots.some((candidate) => (
        candidate.sourceMessageId === latestLegacyTurn.user.id
      ))
      || (reconstructedBridgeFrame.slots.some((candidate) => candidate.slot === 'job_description')
        && looksLikeRecruitmentEvaluationQuestion(latestLegacyTurn.user.text))
    ),
  );
  const adjacentActiveRecruitment = Boolean(
    currentFrame?.status === 'active'
    && (input.discourseContext?.contextScopeId === currentFrame.taskId
      || adjacentReconstructedRecruitment),
  );
  const baseRoute = routeChatTurn({
    request: input.request,
    ledger: input.ledger,
    previous: previousAnchor(input.discourseContext),
    hasUsableHistory: Boolean(input.discourseContext),
  });
  const explicitDiscourseReference = Boolean(input.discourseContext
    && baseRoute.inheritedFromTurnId === input.discourseContext.turnId
    && ['anaphoric_conversation_followup', 'anaphoric_project_catalog_followup']
      .includes(baseRoute.reasonCode));
  const projectSlugs = matchCatalogProjects(message, input.ledger);
  const capabilities = assessCapabilities(message, input.ledger);
  const capability = capabilities.find((candidate) => candidate.evidenceClass !== 'none')
    ?? capabilities[0]
    ?? null;
  const jdLike = looksLikeRecruitmentJobDescription(message, {
    hasActiveRecruitmentFrame: activeRecruitment,
    workflow: input.request.workflow,
  });
  const genericJdDefinitionQuestion = isGenericJdDefinitionQuestion(message);
  const correction = !jdLike && isCorrection(message);
  const switchTask = isSwitch(message);
  const completing = !jdLike && isCompletion(message) && activeRecruitment;
  const clear = jdLike
    ? new Set<ResolvedTaskSlotRef['slot']>()
    : clearKinds(message);
  const hasCurrentRecruitmentSlot = extractSlotCaptures(message, {
    includeJobDescription: jdLike,
    wholeJd: input.request.workflow === 'jd_match',
  }).length > 0;
  const recruitmentEvaluationQuestion = looksLikeRecruitmentEvaluationQuestion(message);
  const adjacentRecruitmentEvaluation = Boolean(
    input.request.workflow === 'chat'
    && input.request.mode === 'interviewer'
    && input.request.audienceIntent === 'recruiter'
    && activeRecruitment
    && adjacentActiveRecruitment
    && currentFrame?.slots.some((candidate) => candidate.slot === 'job_description')
    && !jdLike
    && !switchTask
    && !correction
    && !completing
    && clear.size === 0
    && (baseRoute.routeKind === 'conversation'
      || (baseRoute.routeKind === 'jd_intake' && baseRoute.reasonCode === 'jd_required')
      || (baseRoute.routeKind === 'personal_fact'
        && baseRoute.reasonCode === 'personal_history_query')
      || (baseRoute.routeKind === 'grounded'
        && ['project_fact_query', 'portfolio_evidence_query'].includes(baseRoute.reasonCode)))
    && projectSlugs.length !== 1
    && recruitmentEvaluationQuestion,
  );

  let intent: SemanticIntent;
  let reasonCode: string;
  let deterministicReply: string | null = null;
  let referent: SemanticTurnDecision['referent'] = null;
  let capabilityEvidence: ChatEvidenceClass | undefined;

  if (baseRoute.reasonCode === 'unsafe_or_unverifiable_request') {
    intent = 'clarify';
    reasonCode = baseRoute.reasonCode;
    deterministicReply = baseRoute.deterministicReply;
  } else if (input.request.workflow === 'jd_match') {
    intent = 'jd_match';
    reasonCode = 'explicit_jd_workflow';
    referent = { kind: 'jd', ref: input.currentUserMessageId };
  } else if (completing) {
    intent = currentFrame?.evidenceFocus.topicKind === 'jd' ? 'jd_match' : 'project_fit';
    reasonCode = 'recruitment_task_complete';
  } else if (baseRoute.reasonCode === 'project_experience_query') {
    intent = 'project_catalog';
    reasonCode = baseRoute.reasonCode;
  } else if (baseRoute.reasonCode === 'anaphoric_project_catalog_followup') {
    intent = baseRoute.topicRef ? 'named_project_fact' : 'project_catalog';
    reasonCode = baseRoute.reasonCode;
    referent = baseRoute.topicRef ? { kind: 'project', ref: baseRoute.topicRef } : null;
  } else if (jdLike) {
    intent = 'jd_match';
    reasonCode = activeRecruitment ? 'contextual_jd_match' : 'short_jd_detected';
    referent = { kind: 'jd', ref: input.currentUserMessageId };
  } else if (genericJdDefinitionQuestion) {
    intent = 'general_conversation';
    reasonCode = 'generic_jd_definition';
  } else if (isProjectCatalog(message)) {
    intent = 'project_catalog';
    reasonCode = 'portfolio_project_collection_query';
  } else if (bridgeReconstruction.ambiguous && isProjectFit(message) && !hasCurrentRecruitmentSlot) {
    intent = 'clarify';
    reasonCode = 'ambiguous_legacy_recruitment_context';
    deterministicReply = RECRUITMENT_CLARIFY_REPLY;
  } else if (isProjectFit(message)) {
    if (!activeRecruitment && !/(?:公司|岗位|职位|招聘|候选人)/iu.test(message)) {
      intent = 'clarify';
      reasonCode = 'missing_relevance_referent';
      deterministicReply = RELEVANCE_CLARIFY_REPLY;
    } else {
      intent = 'project_fit';
      reasonCode = 'recruitment_project_fit';
    }
  } else if (projectSlugs.length === 1
    && baseRoute.routeKind === 'grounded'
    && baseRoute.topicKind === 'project'
    && baseRoute.topicRef === projectSlugs[0]) {
    intent = 'named_project_fact';
    reasonCode = baseRoute.reasonCode;
    referent = { kind: 'project', ref: projectSlugs[0] };
  } else if (adjacentRecruitmentEvaluation) {
    intent = 'jd_match';
    reasonCode = 'recruitment_evaluation_follow_up';
    const jdSlot = currentFrame?.slots.find((candidate) => candidate.slot === 'job_description');
    referent = jdSlot ? { kind: 'jd', ref: jdSlot.sourceMessageId } : null;
  } else if (capability && /(?:你|morse|摩斯).{0,16}(?:熟悉|掌握|会不会|会|是否|用过|能力)/iu.test(message)) {
    intent = 'capability_fact';
    reasonCode = 'personal_capability_query';
    referent = { kind: 'capability', ref: capability.capabilityId! };
    capabilityEvidence = capability.evidenceClass === 'none' ? 'unavailable' : capability.evidenceClass;
  } else if ((correction
    || (isBareRecheck(message) && adjacentActiveRecruitment)
    || (isRecruitmentContinuationCue(message) && adjacentActiveRecruitment)) && activeRecruitment) {
    intent = 'project_fit';
    reasonCode = correction ? 'recruitment_context_correction' : 'recruitment_context_follow_up';
  } else if (clear.size > 0 && activeRecruitment) {
    intent = 'recruitment_intake';
    reasonCode = 'recruitment_context_cleared';
    deterministicReply = RECRUITMENT_CLARIFY_REPLY;
  } else if (isPersonalHistoryQuestion(message)) {
    intent = 'unsupported_personal_history';
    reasonCode = 'personal_history_query';
  } else if (baseRoute.routeKind === 'external_current') {
    intent = 'external_current';
    reasonCode = 'external_current_query';
    referent = { kind: 'external', ref: 'controlled-search' };
  } else if (baseRoute.routeKind === 'identity') {
    intent = 'identity_fact';
    reasonCode = 'identity_query';
  } else if (/(?:公司|企业|岗位|职位|招聘|候选人)/iu.test(message)) {
    intent = 'recruitment_intake';
    reasonCode = 'missing_material_job_context';
    deterministicReply = RECRUITMENT_CLARIFY_REPLY;
  } else if (baseRoute.routeKind === 'clarify') {
    intent = 'clarify';
    reasonCode = baseRoute.reasonCode;
    deterministicReply = baseRoute.deterministicReply;
  } else {
    intent = 'general_conversation';
    reasonCode = baseRoute.reasonCode;
  }

  let taskAction: ContextTaskAction;
  if (completing) {
    taskAction = 'complete';
  } else if (switchTask || (input.request.workflow === 'jd_match' && currentFrame?.status === 'completed')) {
    taskAction = 'switch';
  } else if (intent === 'general_conversation' || intent === 'identity_fact' || intent === 'external_current'
    || intent === 'project_catalog' || intent === 'named_project_fact'
    || intent === 'capability_fact' || intent === 'unsupported_personal_history') {
    taskAction = 'temporary';
  } else if (intent === 'clarify' || intent === 'recruitment_intake' || clear.size > 0) {
    taskAction = activeRecruitment ? 'wait' : 'temporary';
  } else if (activeRecruitment) {
    taskAction = 'continue';
  } else {
    taskAction = 'create';
  }

  let discourseAction: DiscourseAction;
  if (taskAction === 'switch' || taskAction === 'create') {
    discourseAction = 'new_task';
  } else if (correction) {
    discourseAction = 'correction';
  } else if (explicitDiscourseReference) {
    discourseAction = 'follow_up';
  } else if (activeRecruitment && taskAction !== 'temporary') {
    discourseAction = 'follow_up';
  } else {
    discourseAction = 'one_shot';
  }

  const candidateFrame = buildCandidateFrame({
    conversationId: input.conversationId,
    currentUserMessageId: input.currentUserMessageId,
    currentFrame,
    taskAction,
    intent,
    message,
    workflow: input.request.workflow,
    taskIdFactory,
    clear,
    includeJd: jdLike,
    extractSlots: jdLike || correction || switchTask
      || (hasCurrentRecruitmentSlot && !recruitmentEvaluationQuestion),
  });
  if (!referent && candidateFrame) {
    const source = candidateFrame.slots.find((candidate) => candidate.slot === 'role')
      ?? candidateFrame.slots.find((candidate) => candidate.slot === 'company');
    if (source) {
      referent = {
        kind: source.slot === 'job_description' ? 'jd' : source.slot,
        ref: source.sourceMessageId,
      };
    }
  }

  const semantic: SemanticTurnDecision = Object.freeze({
    discourseAction,
    subject: ['general_conversation', 'external_current'].includes(intent) ? 'general' : 'morse',
    intent,
    taskAction,
    referent,
    evidencePlan: evidencePlanForIntent(intent),
    confidence: intent === 'clarify' ? 0.45 : 0.9,
    reasonCodes: [
      reasonCode,
      ...(explicitDiscourseReference ? ['explicit_discourse_reference'] : []),
    ],
  });
  const legacyRoute = legacyRouteForSemantic({
    intent,
    reasonCode,
    inheritedFromTurnId: baseRoute.inheritedFromTurnId,
    deterministicReply,
    referent,
    capabilityEvidence,
  });
  const bridgeUsed = Boolean(reconstructedBridgeFrame)
    && ['continue', 'complete'].includes(taskAction)
    && ['project_fit', 'jd_match', 'recruitment_intake'].includes(intent);
  return {
    resolved: Object.freeze({ semantic, legacyRoute }),
    candidateFrame,
    legacyBridgeStatus: legacyBridge.length === 0
      ? 'not_eligible'
      : bridgeReconstruction.ambiguous && intent === 'clarify'
        ? 'ambiguous'
        : bridgeUsed ? 'used' : 'captured',
    legacyBridgeSourceTurnIds: legacyBridge.map((turn) => turn.turnId),
  };
}
