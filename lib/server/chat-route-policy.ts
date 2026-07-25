import type {
  ChatEvidenceClass,
  ChatRouteKind,
  ChatTopicKind,
} from '../contracts/chat.ts';
import type { NormalizedChatRequest } from './chat-core.ts';
import {
  assessCapability,
  assessCapabilities,
  type CapabilityLedger,
} from './capability-evidence.ts';
import { looksLikeFullJobDescription } from './chat-behavior.ts';
import { matchChatProjectSlugs } from './chat-projects.ts';

export interface ChatRouteDecision {
  routeKind: ChatRouteKind;
  reasonCode: string;
  topicKind: ChatTopicKind;
  topicRef: string | null;
  evidenceClass: ChatEvidenceClass;
  inheritedFromTurnId: string | null;
  release: 'segment' | 'complete';
  requiresEmbedding: boolean;
  requiresSearch: boolean;
  deterministicReply: string | null;
}

export interface RouteAnchor {
  turnId: string;
  routeKind: ChatRouteKind;
  reasonCode: string;
  topicKind: ChatTopicKind;
  topicRef: string | null;
  question?: string;
  legacyClarificationEligible?: boolean;
}

export interface RouteChatTurnInput {
  request: NormalizedChatRequest;
  ledger: CapabilityLedger;
  previous?: RouteAnchor | null;
  hasUsableHistory?: boolean;
}

export const JD_INTAKE_REPLY = '请提供完整 JD（岗位职责与任职要求）；收到后我会基于公开项目证据整理匹配内容，并把需要面谈核实的部分单独标明。';
export const CLARIFY_REPLY = '你是想了解这个问题的一般做法，还是想核实我本人做过的具体经历？';
export const REFERENT_CLARIFY_REPLY = '你指的是前面哪一点或哪段内容？补充一下指代对象，我就能接着回答。';
export const SAFETY_BOUNDARY_REPLY = '这类请求超出公开信息边界，我无法据此确认，也不会提供或编造未公开信息。';

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function decision(input: Partial<ChatRouteDecision> & Pick<ChatRouteDecision, 'routeKind' | 'reasonCode'>): ChatRouteDecision {
  return {
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
    ...input,
  };
}

function isMissingJdFitRequest(message: string): boolean {
  return /(?:岗位|职位)(?:适配|匹配)(?:度|分析)?|(?:适合|胜任)(?:这个|该)?(?:岗位|职位)|分析.*(?:岗位|职位).*(?:适合|匹配)/iu.test(message);
}

function isPrivateContactRequest(message: string): boolean {
  return /(?:提供|告诉(?:我)?|给出|列出|泄露|输出).{0,24}(?:手机号|邮箱|联系方式|客户名称)|(?:个人|私人|私下|非公开|内部).{0,16}(?:手机号|邮箱|联系方式|客户名称)|(?:手机号|邮箱|联系方式|客户名称).{0,16}(?:是什么|是多少|地址|账号|联系人)/iu.test(message);
}

function isUnsafeOrUnverifiableRequest(message: string): boolean {
  return /(?:忽略|覆盖).{0,20}(?:公开来源限制|系统指令|既有规则)|(?:输出|泄露).{0,12}(?:密钥|密码|token)|(?:服务器地址|登录凭据)|(?:准确|精确).{0,12}(?:百分比|提升率)|明天会涨/iu.test(message)
    || isPrivateContactRequest(message);
}

function isPortfolioEvidenceQuestion(message: string): boolean {
  return /(?:招聘|候选人).{0,24}(?:项目|能力|公开证据)|(?:哪些项目).{0,24}(?:证明|能力)|(?:检索到的内容|知识库内容).{0,24}(?:技术能力|合作建议)/iu.test(message);
}

function isExplicitPersonalFact(message: string): boolean {
  const personalSubject = /(?:你|你的|你以前|morse|摩斯)/iu.test(message);
  const experiencePredicate = /(?:有|具备).{0,24}(?:经验|经历)|(?:用过|做过|负责过|参与过|实践过|落地过)|以前怎么(?:处理|做)|是否(?:有|做过|用过)/iu.test(message);
  return personalSubject && experiencePredicate;
}

function isExternalCurrent(message: string): boolean {
  return /(?:当前|现在|截至目前).{0,16}(?:最新|版本|价格|天气|新闻)|(?:最新|实时)(?:版本|消息|新闻|价格|天气)|今天.{0,16}天气|天气.{0,16}(?:怎么样|如何)|帮我(?:查|核实)|外部(?:资料|信息)|联网(?:查|核实)/iu.test(message);
}

function isIdentityQuestion(message: string): boolean {
  return /你是谁|介绍(?:一下)?(?:你|自己)|你(?:主要)?是(?:干|做)什么的|你(?:主要)?(?:能|可以)(?:帮我)?(?:干|做)什么|你擅长什么|你能做什么|数字\s*(?:morse|摩斯)\s*是(?:什么|谁)/iu.test(message);
}

function projectTopics(message: string): string[] {
  return matchChatProjectSlugs(message);
}

function projectTopic(message: string): string | null {
  const matches = projectTopics(message);
  return matches.length === 1 ? matches[0] : null;
}

function isProjectFact(message: string): boolean {
  if (projectTopics(message).length > 0) return true;
  return /(?:morse|摩斯|你|你的).{0,24}(?:项目|作品|实现|架构|做法|成果|职责)|(?:有哪些|介绍).{0,12}(?:项目|作品)/iu.test(message);
}

function isProjectCollectionQuestion(message: string): boolean {
  if (projectTopics(message).length > 0) return false;
  if (isPortfolioEvidenceQuestion(message)) return false;
  const hasPublicSubject = /(?:你|你的|morse|摩斯)/iu.test(message);
  if (!hasPublicSubject) return false;
  return /(?:有|做过|完成过|负责过|还做过)(?:的)?(?:哪些|哪一些|什么)(?:其他|别的)?(?:项目|作品)(?!管理|经验|能力|证据)|(?:其他|别的)(?:项目|作品).{0,6}(?:有哪些|是什么|呢)|(?:项目|作品).{0,6}(?:有哪些|有哪一些)|(?:介绍|说说|聊聊).{0,8}(?:你|你的|morse|摩斯).{0,8}(?:项目|作品)(?!管理|经验)/iu.test(message);
}

function isStableGeneralConversation(message: string): boolean {
  if (/^(?:你好|嗨|hello|hi|谢谢|多谢|再见)/iu.test(message)) return true;
  if (/(?:吃饭|吃什么|近况|最近忙|怎么看|什么是|是什么|如何|怎么|怎样|为什么|建议|职场|同事|分歧|兴趣|感受)/iu.test(message)) {
    return !isUnresolvedReference(message);
  }
  return /^(?:请)?(?:解释|介绍|讨论).{1,80}$/iu.test(message);
}

function isUnresolvedReference(message: string): boolean {
  const trimmed = message.trim().replace(/[。！!？?]+$/gu, '');
  if (trimmed.length > 40) return false;
  return /^(?:这个|那个|它|这(?:一)?点|那(?:一)?点|上述|前面|刚才)(?:呢|怎么样|如何|为什么(?:这样|这么)?(?:设计|选)?|怎么(?:做|设计)?(?:的)?|有什么(?:优缺点|问题)?|是否(?:可以|需要)?|可以吗|(?:再)?(?:展开|详细)(?:讲讲|说说|解释一下))?$/iu.test(trimmed)
    || /^(?:为什么(?:这样|这么)?(?:选|设计|做)(?:的)?|怎么(?:做|设计)(?:的)?|那结果|然后呢|还有呢|那(?:什么时候|什么情况下)(?:升级)?|那怎么做)(?:呢)?$/iu.test(trimmed)
    || /^(?:(?:这|那)(?:套|个)?(?:方案|做法|设计|思路|架构))(?:呢|怎么样|如何)?$/iu.test(trimmed)
    || /^(?:哪(?:一)?个(?:最好|更好|最合适)|最(?:有)?代表性的|最推荐哪个|哪个最能代表你|那代表作)(?:呢|吗)?$/iu.test(trimmed);
}

function isPendingPersonalScopeClarification(previous?: RouteAnchor | null): previous is RouteAnchor {
  return previous?.routeKind === 'clarify'
    && previous.reasonCode === 'personal_scope_ambiguous'
    && previous.legacyClarificationEligible === true;
}

function personalScopeSelection(message: string): 'general' | 'personal' | null {
  const normalized = normalize(message);
  if (/^(?:一般|通用|通常|普遍)(?:做法|方法|思路|建议)?$/u.test(normalized)) return 'general';
  if (/^(?:具体|个人|本人|你的|你本人)(?:经历|经验|做法|案例)?$/u.test(normalized)) return 'personal';
  return null;
}

function isExplicitCapabilityContinuation(
  message: string,
  previous: RouteAnchor | null | undefined,
  ledger: CapabilityLedger,
): boolean {
  if (previous?.topicKind !== 'capability' || !previous.topicRef) return false;
  if (!/(?:聊|讲|说|介绍|展开|详细)/u.test(message)) return false;
  return assessCapabilities(message, ledger).some(
    (capability) => capability.capabilityId === previous.topicRef,
  );
}

function capabilityProjectFollowup(
  message: string,
  previous: RouteAnchor | null | undefined,
  ledger: CapabilityLedger,
): ChatRouteDecision | null {
  if (previous?.topicKind !== 'capability' || !previous.topicRef) return null;
  const normalized = normalize(message);
  if (!/^(?:具体)?(?:怎么|如何)(?:实现|做|设计)(?:的)?$/u.test(normalized)) return null;
  const capability = assessCapability(previous.topicRef, ledger);
  const projectSlugs = [...new Set(capability.direct
    .filter((reference) => reference.disclosure === 'public' && reference.projectSlug)
    .map((reference) => reference.projectSlug!))];
  if (projectSlugs.length !== 1) return null;
  return decision({
    routeKind: 'grounded',
    reasonCode: 'anaphoric_capability_project_followup',
    topicKind: 'project',
    topicRef: projectSlugs[0],
    evidenceClass: 'direct',
    inheritedFromTurnId: previous.turnId,
    requiresEmbedding: true,
  });
}

function inheritRoute(previous: RouteAnchor, ledger: CapabilityLedger): ChatRouteDecision | null {
  if (previous.topicKind === 'project') {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'anaphoric_project_followup',
      topicKind: 'project',
      topicRef: previous.topicRef,
      evidenceClass: 'direct',
      inheritedFromTurnId: previous.turnId,
      requiresEmbedding: true,
    });
  }
  if (previous.topicKind === 'capability' && previous.topicRef) {
    const capability = assessCapability(previous.topicRef, ledger);
    return decision({
      routeKind: 'personal_fact',
      reasonCode: 'anaphoric_capability_followup',
      topicKind: 'capability',
      topicRef: previous.topicRef,
      evidenceClass: capability.evidenceClass === 'none'
        ? 'unavailable'
        : capability.evidenceClass,
      inheritedFromTurnId: previous.turnId,
      release: 'complete',
    });
  }
  if (previous.topicKind === 'jd') {
    return decision({
      routeKind: 'jd',
      reasonCode: 'anaphoric_jd_followup',
      topicKind: 'jd',
      topicRef: 'jd',
      evidenceClass: 'mixed',
      inheritedFromTurnId: previous.turnId,
      release: 'complete',
      requiresEmbedding: true,
    });
  }
  if (previous.topicKind === 'external') {
    return decision({
      routeKind: 'external_current',
      reasonCode: 'anaphoric_external_followup',
      topicKind: 'external',
      evidenceClass: 'web',
      inheritedFromTurnId: previous.turnId,
      requiresSearch: true,
    });
  }
  return null;
}

export function routeChatTurn(input: RouteChatTurnInput): ChatRouteDecision {
  const message = input.request.message.trim();
  if (isUnsafeOrUnverifiableRequest(message)) {
    return decision({
      routeKind: 'clarify',
      reasonCode: 'unsafe_or_unverifiable_request',
      deterministicReply: SAFETY_BOUNDARY_REPLY,
    });
  }
  if (input.request.workflow === 'diagnosis') {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'explicit_diagnosis_workflow',
      evidenceClass: 'direct',
      requiresEmbedding: true,
    });
  }
  if (input.request.workflow === 'jd_match' || looksLikeFullJobDescription(message)) {
    return decision({
      routeKind: 'jd',
      reasonCode: input.request.workflow === 'jd_match' ? 'explicit_jd_workflow' : 'full_jd_detected',
      topicKind: 'jd',
      topicRef: 'jd',
      evidenceClass: 'mixed',
      release: 'complete',
      requiresEmbedding: true,
    });
  }
  if (isMissingJdFitRequest(message)) {
    return decision({
      routeKind: 'jd_intake',
      reasonCode: 'jd_required',
      deterministicReply: JD_INTAKE_REPLY,
    });
  }
  if (isPendingPersonalScopeClarification(input.previous)) {
    const selection = personalScopeSelection(message);
    if (selection === 'general') {
      return decision({
        routeKind: 'conversation',
        reasonCode: 'clarification_general_selected',
        inheritedFromTurnId: input.previous.turnId,
      });
    }
    if (selection === 'personal') {
      const capabilities = input.previous.question
        ? assessCapabilities(input.previous.question, input.ledger)
        : [];
      const capability = capabilities.find((candidate) => candidate.evidenceClass !== 'none')
        ?? capabilities[0]
        ?? null;
      return decision({
        routeKind: 'personal_fact',
        reasonCode: 'clarification_personal_selected',
        topicKind: capability?.capabilityId ? 'capability' : 'none',
        topicRef: capability?.capabilityId ?? null,
        evidenceClass: capability && capability.evidenceClass !== 'none'
          ? capability.evidenceClass
          : 'unavailable',
        inheritedFromTurnId: input.previous.turnId,
        release: 'complete',
      });
    }
  }
  if (isExplicitPersonalFact(message) && projectTopics(message).length > 0) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'personal_named_project_query',
      topicKind: 'project',
      topicRef: projectTopic(message),
      evidenceClass: 'direct',
      requiresEmbedding: true,
    });
  }
  if (isProjectCollectionQuestion(message)) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'portfolio_project_collection_query',
      topicKind: 'project',
      topicRef: null,
      evidenceClass: 'direct',
    });
  }
  if (isExplicitPersonalFact(message)) {
    const capabilities = assessCapabilities(message, input.ledger);
    const capability = capabilities.find((candidate) => candidate.evidenceClass !== 'none')
      ?? capabilities[0]
      ?? assessCapability(message, input.ledger);
    return decision({
      routeKind: 'personal_fact',
      reasonCode: capability.capabilityId ? 'personal_capability_query' : 'personal_history_query',
      topicKind: capability.capabilityId ? 'capability' : 'none',
      topicRef: capability.capabilityId,
      evidenceClass: capability.evidenceClass === 'none'
        ? 'unavailable'
        : capability.evidenceClass,
      release: 'complete',
    });
  }
  if (isExternalCurrent(message) && !isProjectFact(message)) {
    return decision({
      routeKind: 'external_current',
      reasonCode: 'external_current_query',
      topicKind: 'external',
      evidenceClass: 'web',
      requiresSearch: true,
    });
  }
  if (isIdentityQuestion(message)) {
    return decision({
      routeKind: 'identity',
      reasonCode: 'identity_query',
      evidenceClass: 'identity',
    });
  }
  if (isPortfolioEvidenceQuestion(message)) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'portfolio_evidence_query',
      evidenceClass: 'direct',
      requiresEmbedding: true,
    });
  }
  if (isProjectFact(message)) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'project_fact_query',
      topicKind: 'project',
      topicRef: projectTopic(message),
      evidenceClass: 'direct',
      requiresEmbedding: true,
    });
  }
  if (isExplicitCapabilityContinuation(message, input.previous, input.ledger)) {
    return inheritRoute(input.previous!, input.ledger)!;
  }
  const capabilityImplementation = capabilityProjectFollowup(
    message,
    input.previous,
    input.ledger,
  );
  if (capabilityImplementation) return capabilityImplementation;
  if (isStableGeneralConversation(message)) {
    return decision({
      routeKind: 'conversation',
      reasonCode: 'stable_general_conversation',
    });
  }
  if (isUnresolvedReference(message)) {
    const inherited = input.previous
      ? inheritRoute(input.previous, input.ledger)
      : null;
    if (inherited) return inherited;
    if (input.hasUsableHistory) {
      return decision({
        routeKind: 'conversation',
        reasonCode: 'anaphoric_conversation_followup',
        inheritedFromTurnId: input.previous?.turnId ?? null,
      });
    }
    return decision({
      routeKind: 'clarify',
      reasonCode: 'anaphoric_topic_unavailable',
      deterministicReply: REFERENT_CLARIFY_REPLY,
    });
  }
  if (isPendingPersonalScopeClarification(input.previous)) {
    return decision({
      routeKind: 'conversation',
      reasonCode: 'clarification_followup',
      inheritedFromTurnId: input.previous.turnId,
    });
  }
  return decision({
    routeKind: 'conversation',
    reasonCode: 'general_conversation_default',
  });
}
