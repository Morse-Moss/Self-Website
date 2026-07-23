import type { ChatWorkflow } from '../contracts/chat.ts';
import { chatCapabilityPolicy } from '../site-content.ts';
import type { TurnIntent } from './chat-behavior.ts';
import type { ChatRouteDecision } from './chat-route-policy.ts';
import { containsCapabilityAlias } from './capability-evidence.ts';
import {
  matchChatProjectSlugs,
  mentionsChatProject,
} from './chat-projects.ts';
import {
  asksRealtimePersonalState,
  preservesDigitalStateBoundary,
} from './chat-personal-state.ts';

export type ChatGuardReason =
  | 'invalid_citation'
  | 'missing_grounded_citation'
  | 'unsolicited_gap_list'
  | 'too_many_interview_confirmations'
  | 'match_percentage'
  | 'forced_next_step'
  | 'developer_assistant_voice'
  | 'system_metadata'
  | 'answer_not_direct'
  | 'wrong_route_format'
  | 'unsupported_personal_state'
  | 'unsupported_evidence_upgrade'
  | 'template_repetition';

export interface ChatGuardResult {
  ok: boolean;
  reasons: ChatGuardReason[];
}

export interface ChatGuardInput {
  answer: string;
  intent?: TurnIntent;
  route?: ChatRouteDecision;
  workflow: ChatWorkflow;
  question: string;
  sourceCount: number;
  hasResumeEvidence?: boolean;
}

type ReasonSet = Set<ChatGuardReason>;

function routeKind(input: ChatGuardInput): ChatRouteDecision['routeKind'] {
  if (input.route) return input.route.routeKind;
  if (input.intent === 'social') return 'conversation';
  if (input.intent === 'identity') return 'identity';
  if (input.intent === 'jd') return 'jd';
  return 'grounded';
}

function citationNumbers(answer: string): number[] {
  return [...answer.matchAll(/\[来源(\d+)\]/gu)].map((match) => Number(match[1]));
}

function validateCitations(input: ChatGuardInput, reasons: ReasonSet, complete: boolean): void {
  const citations = citationNumbers(input.answer);
  if (citations.some((citation) => citation < 1 || citation > input.sourceCount)) {
    reasons.add('invalid_citation');
    return;
  }
  const groundedClaim = /我(?:负责|完成|实现|主导)|项目|系统|能力/iu.test(input.answer);
  const groundedRoute = ['personal_fact', 'grounded', 'jd'].includes(routeKind(input));
  if (complete && groundedRoute && input.sourceCount > 0 && groundedClaim && citations.length === 0) {
    reasons.add('missing_grounded_citation');
  }
}

function isRecruitment(input: ChatGuardInput): boolean {
  return routeKind(input) === 'jd'
    || input.intent === 'recruitment'
    || input.workflow === 'jd_match';
}

function validateRecruitmentLanguage(input: ChatGuardInput, reasons: ReasonSet): void {
  if (!isRecruitment(input)) return;
  if (/匹配(?:度|率)?\s*[:：]?\s*\d{1,3}(?:\.\d+)?%/iu.test(input.answer)) {
    reasons.add('match_percentage');
  }
  const gapRequested = /缺口|不匹配|不足|哪些.*(?:没有|不会|不具备)/iu.test(input.question);
  if (!gapRequested && (
    /缺口清单|明显不匹配|无法声称具备|仍需补充/iu.test(input.answer)
    || /缺少[^。\n]*(?:、|，|,|和)[^。\n]*(?:、|，|,|和)/iu.test(input.answer)
  )) {
    reasons.add('unsolicited_gap_list');
  }

  const confirmations = input.answer.match(/建议面谈(?:确认|核实)/gu)?.length ?? 0;
  if (confirmations > 2) reasons.add('too_many_interview_confirmations');
  const confirmationAllowed = routeKind(input) === 'jd'
    || input.workflow === 'jd_match'
    || /是否|有没有|做过|熟悉/iu.test(input.question);
  if (confirmations > 0 && !confirmationAllowed) reasons.add('unsolicited_gap_list');
}

function validateUnsolicitedBoundaries(input: ChatGuardInput, reasons: ReasonSet): void {
  const boundaryHeading = /(?:目前|当前)?(?:个人)?(?:事实|能力|证据)的边界/iu.test(input.answer);
  const boundaryLanguagePattern = /没有(?:公开)?证据(?:显示|证明)|不能(?:据此)?确认|不能证明|无法确认|未能确认/iu;
  const boundaryLanguage = boundaryLanguagePattern.test(input.answer);
  const boundaryQuestion = /边界|缺口|不足|不匹配|不能证明|没有证据|没做过|不会/iu.test(input.question);
  const personalFactQuestion = /是否|有没有|用过|做过|负责过|参与过|具备|熟悉|经验|经历/iu.test(input.question);
  if ((boundaryHeading || (boundaryLanguage && !personalFactQuestion)) && !boundaryQuestion) {
    reasons.add('unsolicited_gap_list');
  }
  if (!personalFactQuestion || boundaryQuestion) return;
  const requestedCapabilities = chatCapabilityPolicy.canonical.filter((capability) => (
    capability.aliases.some((alias) => containsCapabilityAlias(input.question, alias))
  ));
  if (requestedCapabilities.length === 0) return;
  const unrelatedBoundary = input.answer
    .split(/[。；;！？!?\n]+/u)
    .filter((clause) => boundaryLanguagePattern.test(clause))
    .some((clause) => !requestedCapabilities.some((capability) => (
      capability.aliases.some((alias) => containsCapabilityAlias(clause, alias))
    )));
  if (unrelatedBoundary) reasons.add('unsolicited_gap_list');
}

function validateNextStep(input: ChatGuardInput, reasons: ReasonSet): void {
  const hasSuggestedAction = /下一步\s*[:：]|建议(?:先|你)|你可以(?:先)?/iu.test(input.answer);
  if (!hasSuggestedAction) return;
  const requested = /下一步|建议|怎么做|如何推进|如何开始/iu.test(input.question);
  if (input.workflow !== 'diagnosis' && !requested) reasons.add('forced_next_step');
}

function validateVoice(input: ChatGuardInput, reasons: ReasonSet): void {
  if (/作为(?:AI|开发)助手|招聘审计员|可执行的下一步/iu.test(input.answer)) {
    reasons.add('developer_assistant_voice');
  }
  if (/AGENTS\.md|system prompt|系统提示|turnId|MORSE_CHAT_[A-Z_]+|内部节点别名/iu.test(input.answer)) {
    reasons.add('system_metadata');
  }
  if (
    /(?:能力|证据)(?:证据)?(?:等级|类别|类型)\s*[:：]?\s*(?:direct|transferable|none|unavailable|mixed)\b/iu.test(input.answer)
  ) {
    reasons.add('system_metadata');
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, '');
}

function opinionFocusAnchors(question: string): string[] {
  const match = question.match(/怎么看\s*(.+?)(?:呢|吗)?[？?]*$/iu);
  if (!match?.[1]) return [];
  const topic = match[1].trim().replace(/^(?:关于|对于|对)/u, '');
  const normalizedTopic = normalize(topic);
  if (/^(?:这件事|这个|那个|它|这些|那些|这种情况|那种情况)$/u.test(normalizedTopic)) {
    return [];
  }

  const anchors = new Set<string>();
  const noun = normalize(topic.split('的').at(-1) ?? topic);
  if (noun.length >= 2) anchors.add(noun);
  if (normalizedTopic.length >= 2 && normalizedTopic.length <= 8) anchors.add(normalizedTopic);
  for (const token of normalizedTopic.match(/[a-z][a-z0-9]{1,}/gu) ?? []) anchors.add(token);
  for (const anchor of [...anchors]) {
    if (anchor.endsWith('性') && anchor.length > 2) anchors.add(anchor.slice(0, -1));
  }
  return [...anchors];
}

function validateDirectAnswer(input: ChatGuardInput, reasons: ReasonSet): void {
  const kind = routeKind(input);
  if (kind === 'conversation') {
    const anchors = opinionFocusAnchors(input.question);
    if (anchors.length === 0) return;
    const openingParagraph = input.answer.split(/\n\s*\n/u, 1)[0] ?? input.answer;
    const normalizedOpening = normalize(openingParagraph);
    if (!anchors.some((anchor) => normalizedOpening.includes(anchor))) {
      reasons.add('answer_not_direct');
    }
    return;
  }
  if (kind !== 'grounded' && kind !== 'jd') return;

  const namedProjects = matchChatProjectSlugs(input.question);
  const requestedCapabilities = chatCapabilityPolicy.canonical.filter((capability) => (
    containsCapabilityAlias(input.question, capability.label)
      || capability.aliases.some((alias) => containsCapabilityAlias(input.question, alias))
  ));
  const answersRequestedCapability = requestedCapabilities.some((capability) => (
    capability.aliases.some((alias) => containsCapabilityAlias(input.answer, alias))
  ));
  const naturalSingleProjectReference = namedProjects.length === 1
    && requestedCapabilities.length > 0
    && answersRequestedCapability
    && /我的|这个项目|它/iu.test(input.answer);
  if (
    namedProjects.some((slug) => !mentionsChatProject(input.answer, slug))
    && !naturalSingleProjectReference
  ) {
    reasons.add('answer_not_direct');
    return;
  }
  if (namedProjects.length > 1) {
    const answerClauses = input.answer.split(/[，,。；;！？!?\n]+/u);
    const explainsProject = (slug: typeof namedProjects[number]) => answerClauses.some((clause) => (
      mentionsChatProject(clause, slug)
      && /解决|处理|用于|用来|面向|聚焦|帮助|支持|提供|承担|负责|实现|让|把/iu.test(clause)
    ));
    if (namedProjects.some((slug) => !explainsProject(slug))) {
      reasons.add('answer_not_direct');
      return;
    }
  }

  if (kind === 'grounded' && input.route?.topicKind === 'project' && namedProjects.length === 0) {
    const answerProjects = matchChatProjectSlugs(input.answer);
    const substantive = /解决|处理|用于|用来|面向|聚焦|帮助|支持|提供|承担|负责|实现|架构|设计|取舍|目标|边界|验证|结果|能力|覆盖|证据|展示|沉淀|连接|编排|检索|生成/iu.test(input.answer);
    const inheritedProject = Boolean(input.route.inheritedFromTurnId && input.route.topicRef);
    if (!substantive || (!inheritedProject && answerProjects.length === 0)) {
      reasons.add('answer_not_direct');
    }
  }

  if (kind === 'grounded' && namedProjects.length === 0 && requestedCapabilities.length > 0) {
    if (!answersRequestedCapability) reasons.add('answer_not_direct');
    return;
  }

  if (kind === 'jd') {
    const addressesRole = requestedCapabilities.length > 0
      ? requestedCapabilities.some((capability) => (
        capability.aliases.some((alias) => containsCapabilityAlias(input.answer, alias))
      ))
      : /\bjd\b|岗位|职位|职责|任职|要求/iu.test(input.answer);
    if (!addressesRole) reasons.add('answer_not_direct');
  }
}

function validateRouteFormat(input: ChatGuardInput, reasons: ReasonSet): void {
  if (
    routeKind(input) === 'conversation'
    && /\[来源\d+\]|根据(?:资料|证据)|公开项目|项目匹配|匹配度|建议面谈(?:确认|核实)/iu.test(input.answer)
  ) {
    reasons.add('wrong_route_format');
  }
}

function validateRealtimePersonalState(
  input: ChatGuardInput,
  reasons: ReasonSet,
  complete: boolean,
): void {
  if (
    complete
    && routeKind(input) === 'conversation'
    && asksRealtimePersonalState(input.question)
    && !preservesDigitalStateBoundary(input.answer)
  ) {
    reasons.add('unsupported_personal_state');
  }
}

function validatePersonalFact(input: ChatGuardInput, reasons: ReasonSet, complete: boolean): void {
  if (!complete) return;
  const route = input.route;
  if (route?.routeKind !== 'personal_fact' || route.topicKind !== 'capability' || !route.topicRef) return;
  const policy = chatCapabilityPolicy.canonical.find((entry) => entry.id === route.topicRef);
  const aliases = policy?.aliases ?? [route.topicRef];
  const requestedCapabilities = chatCapabilityPolicy.canonical.filter((capability) => (
    capability.aliases.some((alias) => containsCapabilityAlias(input.question, alias))
  ));
  if (requestedCapabilities.some((capability) => (
    !capability.aliases.some((alias) => containsCapabilityAlias(input.answer, alias))
  ))) {
    reasons.add('answer_not_direct');
    return;
  }
  const mentionsCapability = aliases.some((alias) => containsCapabilityAlias(input.answer, alias));
  if (!mentionsCapability) {
    reasons.add('answer_not_direct');
    return;
  }
  if (
    route.evidenceClass === 'direct'
    && input.sourceCount > 0
    && !input.hasResumeEvidence
    && matchChatProjectSlugs(input.answer).length === 0
  ) {
    reasons.add('answer_not_direct');
    return;
  }
  if (route.evidenceClass !== 'transferable' && route.evidenceClass !== 'unavailable') return;

  const claimClauses = input.answer.split(/(?:但是|不过|然而|但)|[，,。；;！？\n]+/gu);
  const directExperience = claimClauses.some((clause) => {
    if (/(?:不能|无法|未能|没有公开证据)(?:据此)?确认/iu.test(clause)) return false;
    const mentionsRequestedCapability = aliases.some((alias) => (
      normalize(clause).includes(normalize(alias))
    ));
    if (!mentionsRequestedCapability) return false;
    return /(?:我)?(?:有|具备|拥有).{0,16}(?:生产|实战|直接)?(?:经验|实践)|我(?:确实|的确|曾经|曾)?(?:用过|做过|负责过|落地过|实践过)/iu.test(clause);
  });
  if (directExperience) reasons.add('unsupported_evidence_upgrade');
  const preservesBoundary = /不能(?:据此)?确认|没有公开证据|无法确认|未能确认|只能确认|建议面谈核实/iu.test(input.answer);
  if (!preservesBoundary && !directExperience) reasons.add('answer_not_direct');
}

function inspect(input: ChatGuardInput, complete: boolean): ChatGuardResult {
  if (!input.route && !input.intent) throw new TypeError('route or intent is required.');
  const reasons: ReasonSet = new Set();
  validateCitations(input, reasons, complete);
  validateRecruitmentLanguage(input, reasons);
  validateUnsolicitedBoundaries(input, reasons);
  validateNextStep(input, reasons);
  validateVoice(input, reasons);
  validateRouteFormat(input, reasons);
  validateRealtimePersonalState(input, reasons, complete);
  if (complete) validateDirectAnswer(input, reasons);
  validatePersonalFact(input, reasons, complete);
  return { ok: reasons.size === 0, reasons: [...reasons] };
}

export function inspectChatAnswer(input: ChatGuardInput): ChatGuardResult {
  return inspect(input, true);
}

export function inspectChatAnswerPrefix(input: ChatGuardInput): ChatGuardResult {
  return inspect(input, false);
}

function characterBigrams(value: string): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function inspectTemplateRepetition(input: {
  current: string;
  previousAnswers: readonly string[];
  minimumCharacters?: number;
}): ChatGuardResult {
  const minimumCharacters = input.minimumCharacters ?? 80;
  const current = normalize(input.current);
  if (current.length < minimumCharacters) return { ok: true, reasons: [] };
  const currentBigrams = characterBigrams(current);
  const repeated = input.previousAnswers.some((answer) => {
    const previous = normalize(answer);
    if (previous.length < minimumCharacters) return false;
    return previous === current
      || jaccard(currentBigrams, characterBigrams(previous)) >= 0.9;
  });
  return repeated
    ? { ok: false, reasons: ['template_repetition'] }
    : { ok: true, reasons: [] };
}
