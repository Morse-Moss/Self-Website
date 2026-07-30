export interface RecruitmentSignalsV1 {
  explicitJdLabel: boolean;
  hasDutyPredicate: boolean;
  hasList: boolean;
  hasRole: boolean;
  isCapabilityQuestion: boolean;
}

const rolePattern = /(?:岗位|职位|招聘|候选人|\bJD\b)|(?:工程师|产品经理|架构师|运营|设计师|负责人|专家)(?=$|[\s,，。;；:：])|(?:developer|engineer|product\s+manager)\b/iu;
const dutyPattern = /(?:负责|要求|需要|掌握|熟悉|经验|优先|能够|交付)/iu;
const structuredJdLabelPattern = /(?:^|[\r\n])\s*(?:\bJD\b|岗位职责|工作职责|职位描述|职责描述|任职要求|岗位要求|职位要求|资格要求|任职资格)\s*(?:(?:[:：]\s*\S)|(?:(?:是|为)\s*(?!什么|哪|是否|吗|么|什么意思|指什么)\S))/iu;
const explicitRecruitmentEvaluationPattern = /(?:\bJD\b|岗位|职位|招聘|候选人|匹配|优势|缺口|差距|短板|风险|证明|项目|经历|经验|能力|胜任|适合|职责|承担|负责|交付|验证|回滚|部署|上线|迭代)/iu;
const professionalDomainPattern = /(?:需求|业务|产品|用户|数据|代码|前端|后端|全栈|架构|技术|模型|Claude\s*Code|Agent|自动化|团队|指标)/iu;
const professionalActionPattern = /(?:承担|负责|交付|开发|接手|保证|验证|回滚|部署|上线|迭代|依据|转成|实现|设计|优化|解决|协作|复盘|分析|评估|搭建|改进|应对|切换|判断|执行|追问|确认|拒绝)/iu;
const genericKnowledgeQuestionPattern = /^(?:请问)?(?:什么是|什么叫|是什么意思|指什么|怎么理解|为什么)[^?？]{0,80}[?？。！!]*$|^[^?？]{1,80}(?:是什么|是指什么)[?？。！!]*$/iu;
const recruitmentEvaluationAnchorPattern = /(?:岗位|职位|JD|招聘|候选|你|本人|个人|匹配|优势|缺口|差距|短板|风险|证明|经历|经验|能力|胜任|适合|职责|承担|负责|交付|验证|回滚|部署|上线|迭代)/iu;
const genericJdDefinitionPattern = /^(?:\bJD\b|岗位职责|工作职责|职位描述|职责描述|任职要求|岗位要求|职位要求|资格要求|任职资格)\s*(?:是|为)?\s*(?:什么|哪|是否|吗|么|什么意思|指什么|是什么|是指什么)/iu;

export function isGenericJdDefinitionQuestion(message: string): boolean {
  return genericJdDefinitionPattern.test(message.trim());
}

export function isGenericKnowledgeQuestion(message: string): boolean {
  return genericKnowledgeQuestionPattern.test(message.trim());
}

export function looksLikeRecruitmentEvaluationQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (genericJdDefinitionPattern.test(trimmed)
    || (genericKnowledgeQuestionPattern.test(trimmed)
    && (!recruitmentEvaluationAnchorPattern.test(trimmed)
      || genericJdDefinitionPattern.test(trimmed)))) {
    return false;
  }
  const hasQuestionStructure = /[?？]/u.test(trimmed)
    || /^(?:请)?(?:如何|怎么|怎样|为什么|哪个|哪些|是否|能否|可否|结合|综合|比较|分析|说明|列出|给出|介绍|回答|当前|独立)/iu.test(trimmed)
    || /(?:什么|哪些|吗|么|是否|能否|可否)[。！!]*$/iu.test(trimmed)
    || /(?:^|[\r\n])\s*(?:[-*•]|\d+[.)、])\s*(?:如何|怎么|怎样|为什么|哪个|哪些|分析|说明|列出|比较)/iu.test(trimmed);
  return hasQuestionStructure && (
    explicitRecruitmentEvaluationPattern.test(trimmed)
    || (professionalDomainPattern.test(trimmed) && professionalActionPattern.test(trimmed))
  );
}

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
    explicitJdLabel: structuredJdLabelPattern.test(message)
      || /(?:^|[\r\n])\s*(?:这是|以下是|补充)(?:一份|这份|新的)?\s*\bJD\b\s*[:：]\s*\S/iu.test(message),
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
  if (signals.explicitJdLabel) return true;
  if (looksLikeRecruitmentEvaluationQuestion(message) || signals.isCapabilityQuestion) return false;
  if (signals.hasList && signals.hasRole) return true;
  if (options.hasActiveRecruitmentFrame && (signals.hasDutyPredicate || signals.hasList)) return true;
  return signals.hasRole && (signals.hasDutyPredicate || signals.hasList);
}

export function looksLikeFullJobDescription(message: string): boolean {
  return looksLikeRecruitmentJobDescription(message);
}
