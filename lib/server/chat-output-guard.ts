import type { ChatWorkflow } from '../contracts/chat.ts';
import type { TurnIntent } from './chat-behavior.ts';

export type ChatGuardReason =
  | 'invalid_citation'
  | 'missing_grounded_citation'
  | 'unsolicited_gap_list'
  | 'too_many_interview_confirmations'
  | 'match_percentage'
  | 'forced_next_step'
  | 'developer_assistant_voice'
  | 'system_metadata';

export interface ChatGuardResult {
  ok: boolean;
  reasons: ChatGuardReason[];
}

export interface ChatGuardInput {
  answer: string;
  intent: TurnIntent;
  workflow: ChatWorkflow;
  question: string;
  sourceCount: number;
}

type ReasonSet = Set<ChatGuardReason>;

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
  if (input.sourceCount > 0 && groundedClaim && citations.length === 0) {
    reasons.add('missing_grounded_citation');
  }
}

function validateRecruitmentLanguage(input: ChatGuardInput, reasons: ReasonSet): void {
  if (input.intent !== 'recruitment' && input.intent !== 'jd') return;

  if (/匹配(?:度|率)?\s*[:：]?\s*\d{1,3}(?:\.\d+)?%/iu.test(input.answer)) {
    reasons.add('match_percentage');
  }
  if (
    /缺口清单|明显不匹配|无法声称具备|仍需补充/iu.test(input.answer)
    || /缺少[^。\n]*(?:、|，|,|和)[^。\n]*(?:、|，|,|和)/iu.test(input.answer)
  ) {
    reasons.add('unsolicited_gap_list');
  }

  const confirmations = input.answer.match(/建议面谈确认/gu)?.length ?? 0;
  if (confirmations > 2) reasons.add('too_many_interview_confirmations');
  const confirmationAllowed = input.intent === 'jd'
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

export function inspectChatAnswer(input: ChatGuardInput): ChatGuardResult {
  const reasons: ReasonSet = new Set();
  validateCitations(input, reasons);
  validateRecruitmentLanguage(input, reasons);
  validateNextStep(input, reasons);
  validateVoice(input, reasons);
  return { ok: reasons.size === 0, reasons: [...reasons] };
}
