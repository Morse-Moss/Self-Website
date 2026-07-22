import type { ChatWorkflow } from '../contracts/chat.ts';
import { chatCapabilityPolicy } from '../site-content.ts';
import type { TurnIntent } from './chat-behavior.ts';
import type { ChatRouteDecision } from './chat-route-policy.ts';

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

function validateCitations(input: ChatGuardInput, reasons: ReasonSet): void {
  const citations = citationNumbers(input.answer);
  if (citations.some((citation) => citation < 1 || citation > input.sourceCount)) {
    reasons.add('invalid_citation');
    return;
  }
  const groundedClaim = /我(?:负责|完成|实现|主导)|项目|系统|能力/iu.test(input.answer);
  const groundedRoute = ['identity', 'personal_fact', 'grounded', 'jd'].includes(routeKind(input));
  if (groundedRoute && input.sourceCount > 0 && groundedClaim && citations.length === 0) {
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
  if (
    /缺口清单|明显不匹配|无法声称具备|仍需补充/iu.test(input.answer)
    || /缺少[^。\n]*(?:、|，|,|和)[^。\n]*(?:、|，|,|和)/iu.test(input.answer)
  ) {
    reasons.add('unsolicited_gap_list');
  }

  const confirmations = input.answer.match(/建议面谈(?:确认|核实)/gu)?.length ?? 0;
  if (confirmations > 2) reasons.add('too_many_interview_confirmations');
  const confirmationAllowed = routeKind(input) === 'jd'
    || input.workflow === 'jd_match'
    || /是否|有没有|做过|熟悉/iu.test(input.question);
  if (confirmations > 0 && !confirmationAllowed) reasons.add('unsolicited_gap_list');
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
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, '');
}

function validateRouteFormat(input: ChatGuardInput, reasons: ReasonSet): void {
  if (
    routeKind(input) === 'conversation'
    && /\[来源\d+\]|根据(?:资料|证据)|公开项目|项目匹配|匹配度|建议面谈(?:确认|核实)/iu.test(input.answer)
  ) {
    reasons.add('wrong_route_format');
  }
}

function validatePersonalFact(input: ChatGuardInput, reasons: ReasonSet): void {
  const route = input.route;
  if (route?.routeKind !== 'personal_fact' || route.topicKind !== 'capability' || !route.topicRef) return;
  const policy = chatCapabilityPolicy.canonical.find((entry) => entry.id === route.topicRef);
  const aliases = policy?.aliases ?? [route.topicRef];
  const normalizedAnswer = normalize(input.answer);
  const mentionsCapability = aliases.some((alias) => normalizedAnswer.includes(normalize(alias)));
  if (!mentionsCapability) {
    reasons.add('answer_not_direct');
    return;
  }
  if (route.evidenceClass !== 'transferable' && route.evidenceClass !== 'unavailable') return;

  const directExperience = /(?:我)?(?:有|具备|拥有).{0,16}(?:生产|实战|直接)?(?:经验|实践)|我(?:做过|负责过|落地过|实践过)/iu.test(input.answer);
  if (directExperience) reasons.add('unsupported_evidence_upgrade');
  const preservesBoundary = /不能据此确认|没有公开证据|无法确认|未能确认|只能确认|建议面谈核实/iu.test(input.answer);
  if (!preservesBoundary && !directExperience) reasons.add('answer_not_direct');
}

export function inspectChatAnswer(input: ChatGuardInput): ChatGuardResult {
  if (!input.route && !input.intent) throw new TypeError('route or intent is required.');
  const reasons: ReasonSet = new Set();
  validateCitations(input, reasons);
  validateRecruitmentLanguage(input, reasons);
  validateNextStep(input, reasons);
  validateVoice(input, reasons);
  validateRouteFormat(input, reasons);
  validatePersonalFact(input, reasons);
  return { ok: reasons.size === 0, reasons: [...reasons] };
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
