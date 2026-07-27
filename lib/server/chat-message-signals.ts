export interface RecruitmentSignalsV1 {
  explicitJdLabel: boolean;
  hasDutyPredicate: boolean;
  hasList: boolean;
  hasRole: boolean;
  isCapabilityQuestion: boolean;
}

const rolePattern = /(?:岗位|职位|招聘|候选人|\bJD\b)|(?:工程师|产品经理|架构师|运营|设计师|负责人|专家)(?=$|[\s,，。;；:：])|(?:developer|engineer|product\s+manager)\b/iu;
const dutyPattern = /(?:负责|要求|需要|掌握|熟悉|经验|优先|能够|交付)/iu;

export function detectRecruitmentSignals(message: string): RecruitmentSignalsV1 {
  const trimmed = message.trim();
  const listItems = message
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => /^(?:[-*•]|\d+[.)、])/u.test(line))
    .filter((line) => dutyPattern.test(line));
  const isCapabilityQuestion = /(?:你|morse|摩斯).{0,12}(?:熟悉|掌握|会不会|会|是否|做过|有).{0,24}(?:吗|么|\?|？)$/iu.test(trimmed)
    || (!/[\r\n]/u.test(trimmed)
      && /(?:是什么|为什么|怎么|如何|哪些场景|适合什么)/iu.test(trimmed)
      && /(?:\?|？)$/u.test(trimmed));
  return {
    explicitJdLabel: /(?:\bJD\b|岗位职责|工作职责|职位描述|职责描述|任职要求|岗位要求|职位要求|资格要求|任职资格)\s*[:：]?\s*\S/iu.test(message),
    hasDutyPredicate: dutyPattern.test(message),
    hasList: listItems.length >= 2,
    hasRole: rolePattern.test(message),
    isCapabilityQuestion,
  };
}

export function looksLikeRecruitmentJobDescription(
  message: string,
  options: { hasActiveRecruitmentFrame?: boolean; workflow?: string } = {},
): boolean {
  if (options.workflow === 'jd_match') return true;
  const signals = detectRecruitmentSignals(message);
  if (signals.isCapabilityQuestion) return false;
  if (signals.explicitJdLabel) return true;
  if (options.hasActiveRecruitmentFrame && (signals.hasDutyPredicate || signals.hasList)) return true;
  return signals.hasRole && (signals.hasDutyPredicate || signals.hasList);
}

export function looksLikeFullJobDescription(message: string): boolean {
  return looksLikeRecruitmentJobDescription(message);
}
