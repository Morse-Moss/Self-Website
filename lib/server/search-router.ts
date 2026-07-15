export interface SearchRouteInput {
  question: string;
  searchEnabled: boolean;
  searchCount: number;
  localEvidenceSufficient: boolean;
  explicitVerification?: boolean;
}

export type SearchRouteReason =
  | 'personal_fact_veto'
  | 'disabled'
  | 'quota_exhausted'
  | 'explicit_verification'
  | 'recency'
  | 'external_technical'
  | 'local_sufficient'
  | 'local_insufficient';

export interface SearchRouteDecision {
  shouldSearch: boolean;
  query: string | null;
  reason: SearchRouteReason;
}

const namedIdentityPattern = /(?:\bMorse\b|摩斯|陈彦)/iu;
const chineseSelfSubjectPattern = /你(?:(?:本人|自己)(?:的)?|的|(?:个人|最新|最近|目前|现在|过去|曾经|公开|主要|完整|最有代表性)+的|做过|在做|负责|开发过|参与过|有(?:哪些|什么)|会(?:哪些|什么))/iu;
const englishSelfSubjectPattern = /(?:\byour\b|\byourself\b|\bwho\s+are\s+you\b|\bwhat\s+do\s+you\s+do\b|\b(?:have|did)\s+you\s+(?:build|built|develop(?:ed)?|create|created|work(?:ed)?\s+on|maintain(?:ed)?|lead|led)\b|\byou\s+(?:build|built|develop(?:ed)?|create|created|work(?:ed)?\s+on|maintain(?:ed)?|lead|led)\b|\btell\s+me\s+about\s+yourself\b)/iu;
const siteOwnerPattern = /(?:(?:这个|本|贵)(?:网站|站)(?:的)?(?:作者|站长)|^(?:请问[，,\s]*)?站长(?:本人)?(?:的)?|\b(?:(?:this|the|our)\s+)?(?:website|site)(?:'s)?\s+(?:author|owner)\b|\b(?:author|owner)\s+of\s+(?:(?:this|the|our)\s+)?(?:website|site)\b)/iu;
const personalFactPattern = /(?:是谁|叫什么|姓名|名字|自己|背景|履历|经历|简历|工作|职业|负责|做过|在做|项目|系统|作品|作者|站长|联系方式|邮箱|微信|电话|手机号|能力|技能|技术栈|对话(?:数|量)|token|消耗|统计)/iu;
const englishPersonalFactPattern = /(?:\bwho\b|\byourself\b|\bwhat\s+do\s+you\s+do\b|\bname\b|\bbackground\b|\bresume\b|\bexperience\b|\bwork(?:\s+history)?\b|\bcareer\b|\bprojects?\b|\bsystems?\b|\bportfolio\b|\bauthor\b|\bowner\b|\bcontact\b|\bemail\b|\bphone\b|\bskills?\b|\btech(?:nology)?\s+stack\b|\bstatistics?\b)/iu;
const explicitVerificationPattern = /(?:核验|查证|事实核查|验证一下|verify|fact[ -]?check)/i;
const recencyPattern = /(?:时效|最新|今天|当前|现在|近期|版本|latest|today|current version|up[ -]?to[ -]?date|release)/i;
const externalTechnicalPattern = /(?:官方文档|技术文档|外部资料|API|SDK|GitHub|Next\.js|OpenAI|React|TypeScript|PostgreSQL|pgvector|Bocha|博查)/i;

export function routeSearch(input: SearchRouteInput): SearchRouteDecision {
  const subjectQuestion = input.question.replace(
    /^(?:(?:请问|你好)[，,]?\s*)?(?:Morse|摩斯)[，,:：\s]+/iu,
    '',
  );
  const identityQuestion = subjectQuestion
    .replace(/摩斯电码/giu, '')
    .replace(/\bMorse\s+code\b/giu, '')
    .replace(/\bOpenAI\s+Morse\s+API\b/giu, '');
  const hasPersonalSubject = namedIdentityPattern.test(identityQuestion)
    || chineseSelfSubjectPattern.test(identityQuestion)
    || englishSelfSubjectPattern.test(identityQuestion)
    || siteOwnerPattern.test(identityQuestion);
  const hasPersonalFact = personalFactPattern.test(identityQuestion)
    || englishPersonalFactPattern.test(identityQuestion);
  if (hasPersonalSubject && hasPersonalFact) {
    return { shouldSearch: false, query: null, reason: 'personal_fact_veto' };
  }
  if (!input.searchEnabled) {
    return { shouldSearch: false, query: null, reason: 'disabled' };
  }
  if (input.searchCount >= 5) {
    return { shouldSearch: false, query: null, reason: 'quota_exhausted' };
  }

  const query = input.question.trim();
  if (input.explicitVerification === true || explicitVerificationPattern.test(query)) {
    return { shouldSearch: true, query, reason: 'explicit_verification' };
  }
  if (recencyPattern.test(query)) {
    return { shouldSearch: true, query, reason: 'recency' };
  }
  if (externalTechnicalPattern.test(query)) {
    return { shouldSearch: true, query, reason: 'external_technical' };
  }
  if (input.localEvidenceSufficient) {
    return { shouldSearch: false, query: null, reason: 'local_sufficient' };
  }
  return { shouldSearch: true, query, reason: 'local_insufficient' };
}
