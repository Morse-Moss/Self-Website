import type { ChatRouteKind, ChatTopicKind } from '../contracts/chat.ts';
import type {
  ChatRouteDecision,
  NormalizedChatRequest,
} from '../contracts/chat-runtime.ts';
import {
  assessCapability,
  assessCapabilities,
  type CapabilityLedger,
} from './capability-evidence.ts';
import { looksLikeFullJobDescription } from './chat-message-signals.ts';
import {
  compiledChatEvidenceCatalog,
  matchCatalogProjects,
  matchOrderedCatalogProjects,
} from './chat-evidence-catalog.ts';

export type { ChatRouteDecision } from '../contracts/chat-runtime.ts';

export interface RouteAnchor {
  turnId: string;
  routeKind: ChatRouteKind;
  reasonCode: string;
  topicKind: ChatTopicKind;
  topicRef: string | null;
  answer?: string;
  question?: string;
  legacyClarificationEligible?: boolean;
  previousTurnCompleted?: boolean;
}

export interface RouteChatTurnTaskState {
  topicKind: Exclude<ChatTopicKind, 'none'>;
  topicRef: string;
  status: 'active' | 'waiting_input' | 'completed';
  lastSuccessfulTurnId: string | null;
}

export interface RouteChatTurnInput {
  request: NormalizedChatRequest;
  ledger: CapabilityLedger;
  previous?: RouteAnchor | null;
  hasUsableHistory?: boolean;
  taskState?: RouteChatTurnTaskState | null;
}


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
    safetyBoundary: null,
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
  return matchCatalogProjects(message, compiledChatEvidenceCatalog);
}

function projectTopic(message: string): string | null {
  const matches = projectTopics(message);
  return matches.length === 1 ? matches[0] : null;
}

function isProjectFact(message: string): boolean {
  if (projectTopics(message).length > 0) return true;
  return /(?:morse|摩斯|你|你的).{0,24}(?:项目|作品|实现|架构|做法|成果|职责)|(?:有哪些|介绍).{0,12}(?:项目|作品)/iu.test(message);
}

function hasDeicticProjectReference(message: string): boolean {
  if (/(?:第[一二三四五六七八九十\d]+(?:个|项|个项目)?|首个|最后一个|前者|后者)/iu.test(message)) return false;
  return /(?:这个|那个|它)(?:项目|系统|产品|作品|方案)(?:里|中|上)?|它(?:们)?/iu.test(message);
}

function isProjectCollectionQuestion(message: string): boolean {
  if (projectTopics(message).length > 0) return false;
  if (isPortfolioEvidenceQuestion(message)) return false;
  const hasPublicSubject = /(?:你|你的|morse|摩斯)/iu.test(message);
  if (!hasPublicSubject) return false;
  if (/你最近做的项目.{0,16}(?:哪个|哪一个).{0,8}(?:最能)?代表你的能力/iu.test(message)) return true;
  return /(?:有|做过|完成过|负责过|还做过)(?:的)?(?:哪些|哪一些|什么)(?:其他|别的)?(?:项目|作品)(?!管理|经验|能力|证据)|(?:其他|别的)(?:项目|作品).{0,6}(?:有哪些|是什么|呢)|(?:项目|作品).{0,6}(?:有哪些|有哪一些)|(?:介绍|说说|聊聊).{0,8}(?:你|你的|morse|摩斯).{0,8}(?:项目|作品)(?!管理|经验)/iu.test(message);
}

function isProjectExperienceNarrativeQuestion(request: NormalizedChatRequest): boolean {
  const message = request.message;
  const aiDelivery = /(?:AI|人工智能|Agent|智能化|自动化).{0,24}(?:项目|案例)|(?:项目|案例).{0,24}(?:AI|人工智能|Agent|智能化|自动化)/iu.test(message);
  const narrativeRequest = /(?:请)?(?:讲|分享|介绍|说说|聊聊|举例)/iu.test(message)
    && /(?:一个|一项|一次)/iu.test(message);
  const methodologyQuestion = /(?:如何|怎么|怎样)(?:来)?(?:介绍|讲述|分享)|(?:介绍|讲述|分享).{0,24}(?:应该|应当)(?:如何|怎么|怎样)/iu.test(message);
  const deliveryVerb = /(?:做过|参与过|负责过|落地过|交付过|完成过|实现过)/iu.exec(message);
  const deliveryPrefix = deliveryVerb ? message.slice(0, deliveryVerb.index) : '';
  const normalizedDeliveryPrefix = normalize(deliveryPrefix);
  const selfDelivery = /(?:你本人|你|本人|morse|摩斯)(?:真正|真实|实际|亲自|确实|的确|曾经|以前|之前)?$/iu.test(
    normalizedDeliveryPrefix,
  );
  const implicitInterviewDelivery = request.mode === 'interviewer'
    && request.audienceIntent === 'recruiter'
    && deliveryVerb !== null
    && /^(?:请)?(?:讲|分享|介绍|说说|聊聊|举例)(?:一下)?(?:一个|一项|一次)?(?:真正|真实|实际|确实)?$/u.test(
      normalizedDeliveryPrefix,
    );
  const pastDelivery = selfDelivery || implicitInterviewDelivery;
  return aiDelivery
    && narrativeRequest
    && !methodologyQuestion
    && pastDelivery;
}

function isStableGeneralConversation(message: string): boolean {
  if (/^(?:你好|嗨|hello|hi|谢谢|多谢|再见)/iu.test(message)) return true;
  if (/(?:吃饭|吃什么|近况|最近忙|怎么看|什么是|是什么|职场|同事|分歧|兴趣|感受)/iu.test(message)) {
    return !isUnresolvedReference(message);
  }
  return /^(?:请)?(?:解释|介绍|讨论).{1,80}$/iu.test(message);
}

function isAcknowledgement(message: string | undefined): boolean {
  if (!message) return false;
  return /^(?:谢谢|多谢|感谢|好的|好|行|收到|明白|了解|嗯+|哦+|噢+|再见)$/u.test(
    normalize(message),
  );
}

function isUnresolvedReference(message: string): boolean {
  const trimmed = message.trim().replace(/[。！!？?]+$/gu, '');
  if (trimmed.length > 40) return false;
  if (/^(?:(?:那)?它|它们|这(?:个|套)?(?:项目|系统|方案|做法|设计|架构)|那(?:个|套)?(?:项目|系统|方案|做法|设计|架构)).{1,32}$/iu.test(trimmed)) {
    return true;
  }
  return /^(?:这个|那个|它|这(?:一)?点|那(?:一)?点|上述|前面|刚才)(?:呢|怎么样|如何|为什么(?:这样|这么)?(?:设计|选)?|怎么(?:做|设计)?(?:的)?|有什么(?:优缺点|问题)?|是否(?:可以|需要)?|可以吗|(?:再)?(?:展开|详细)(?:讲讲|说说|解释一下))?$/iu.test(trimmed)
    || /^(?:为什么(?:这样|这么)?(?:选|设计|做|说)(?:的)?|怎么(?:做|设计)(?:的)?|那结果|然后呢|还有呢|那(?:什么时候|什么情况下)(?:升级)?|那怎么做)(?:呢)?$/iu.test(trimmed)
    || /^(?:(?:这|那)(?:套|个)?(?:方案|做法|设计|思路|架构))(?:呢|怎么样|如何)?$/iu.test(trimmed)
    || /^(?:哪(?:一)?个(?:最好|更好|最合适)|最(?:有)?代表性的|最推荐哪个|哪个最能代表你|那代表作)(?:呢|吗)?$/iu.test(trimmed);
}

function projectCatalogDiscourseReferent(message: string, previous: RouteAnchor): string | null {
  const normalizedMessage = message.normalize('NFKC');
  const priorAnswerReference = /(?:刚才|前面|上面|上一(?:轮|条)|上述|这些|这几个|其中)/iu.test(normalizedMessage);
  if (!priorAnswerReference) return null;
  const priorProjects = matchOrderedCatalogProjects(
    previous.answer ?? '',
    compiledChatEvidenceCatalog,
  );
  if (priorProjects.length < 2) return null;
  const selectionAction = /(?:介绍|展开|说明|讲讲|讲|说说|分析|选择|选|聊聊|聊|讨论|谈谈|谈|看|考虑|比较|对比|聚焦|处理)/iu;
  const detailCue = /(?:重点|具体|详细|怎么|如何|为什么|什么|哪(?:个|一)|是什么|呢)/iu;
  const projectDetailSemantic = /(?:故障|失败|根因|架构|设计|实现|验证|结果|能力|职责|项目|业务|交付|技术|取舍|上线|恢复|部署|流程|风险)/iu;
  const topicSwitch = /^(?:另外|顺便|再问|然后|接着|换个|还有)/iu;
  const negativeSelection = /(?:(?:不要|不想|不愿|不再|不必|不用|无需|无须|别|先不|暂不|不|未|莫)[^，,。；;！？!?\n]{0,12}(?:考虑|选择|选|介绍|展开|说明|讲|说|聊|讨论|谈|看|比较|对比|聚焦|处理))|(?:跳过|略过|忽略|排除|剔除|舍弃|放弃)/iu;
  const selectionClause = (index: number): string => {
    const before = normalizedMessage.slice(0, index);
    const clauseStart = Math.max(
      before.lastIndexOf('，'), before.lastIndexOf(','), before.lastIndexOf('。'),
      before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('！'),
      before.lastIndexOf('!'), before.lastIndexOf('？'), before.lastIndexOf('?'),
      before.lastIndexOf('\n'),
    );
    const after = normalizedMessage.slice(index);
    const clauseEnd = /[，,。；;！？!?\n]/u.exec(after)?.index ?? after.length;
    return normalizedMessage.slice(clauseStart + 1, index + clauseEnd);
  };
  const continuationClause = (endIndex: number): string => {
    const tail = normalizedMessage.slice(endIndex).trimStart();
    if (!/^[，,：:]/u.test(tail)) return '';
    return tail
      .replace(/^[，,：:]\s*/u, '')
      .split(/[，,。；;！？!?\n]/u, 1)[0]
      ?.trim() ?? '';
  };
  const candidateRefs = new Set<string>();
  const addCandidate = (ordinal: string, index: number, endIndex: number): void => {
    const clause = selectionClause(index);
    const continuation = continuationClause(endIndex);
    if (negativeSelection.test(clause) || negativeSelection.test(continuation)) return;
    const clauseSelectsCandidate = selectionAction.test(clause)
      || (detailCue.test(clause) && projectDetailSemantic.test(clause));
    const continuationExpandsCandidate = !topicSwitch.test(continuation)
      && projectDetailSemantic.test(continuation)
      && (selectionAction.test(continuation) || detailCue.test(continuation));
    if (!clauseSelectsCandidate && !continuationExpandsCandidate) return;
    const chineseOrdinals: Record<string, number> = {
      一: 1, 二: 2, 三: 3, 四: 4, 五: 5,
      六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
    };
    const position = /^\d+$/u.test(ordinal) ? Number(ordinal) : chineseOrdinals[ordinal];
    const ref = position && position <= priorProjects.length ? priorProjects[position - 1] : null;
    if (ref) candidateRefs.add(ref);
  };
  if (priorProjects.length === 2) {
    for (const match of normalizedMessage.matchAll(/(?:前者|后者)(?=$|[，,。；;：:！？!?的和与及、])/giu)) {
      addCandidate(match[0] === '前者' ? '1' : '2', match.index, match.index + match[0].length);
    }
  }
  for (const match of normalizedMessage.matchAll(/第([一二三四五六七八九十\d]+)个(?:项目|案例|作品|系统)(?=$|[，,。；;：:！？!?的和与及、])/giu)) {
    if (match[1]) addCandidate(match[1], match.index, match.index + match[0].length);
  }
  for (const clauseMatch of normalizedMessage.matchAll(/[^，,。；;！？!?\n]+/gu)) {
    const clause = clauseMatch[0];
    for (const head of clause.matchAll(/(?:项目|案例|作品|系统)(?=$|[：:的和与及、])/gu)) {
      const prefix = clause.slice(0, head.index);
      for (const ordinal of prefix.matchAll(/第([一二三四五六七八九十\d]+)(?:个)?/gu)) {
        if (!ordinal[1]) continue;
        const between = prefix.slice(ordinal.index + ordinal[0].length);
        const residue = between
          .replace(/第[一二三四五六七八九十\d]+(?:个)?/gu, '')
          .replace(/(?:或者|以及|、|和|与|及|或|\s)/gu, '');
        if (residue) continue;
        const index = clauseMatch.index + ordinal.index;
        const sharedHeadEnd = clauseMatch.index + head.index + head[0].length;
        addCandidate(ordinal[1], index, sharedHeadEnd);
      }
    }
  }
  const addOmittedReferentCandidates = (expression: RegExp): void => {
    for (const match of normalizedMessage.matchAll(expression)) {
      if (!match[1]) continue;
    const tail = normalizedMessage.slice(match.index + match[0].length).trimStart();
      if (!tail) {
        addCandidate(match[1], match.index, match.index + match[0].length);
        continue;
      }
    const continuation = /^[，,：:]/u.test(tail)
      ? tail.replace(/^[，,：:]\s*/u, '')
      : null;
    const firstClause = continuation?.split(/[。；;！？!?\n]/u, 1)[0]?.trim() ?? '';
    if (!firstClause
        || negativeSelection.test(firstClause)
      || !/^(?:请)?(?:说明|介绍|展开|具体|详细|其中|重点|说说|讲讲|分析)/iu.test(firstClause)
      || !/(?:故障|根因|架构|设计|实现|验证|结果|能力|职责|项目|业务|交付|技术|取舍|上线|恢复|部署|流程|风险)/iu.test(firstClause)) {
        continue;
      }
      addCandidate(match[1], match.index, match.index + match[0].length);
    }
  };
  addOmittedReferentCandidates(/(?:展开|介绍|说明|讲讲|说说|分析|选择|选|聊聊)(?:一下|具体|详细)?(?:其中)?第([一二三四五六七八九十\d]+)个/giu);
  addOmittedReferentCandidates(/(?:其中|上述|这几个|这些)(?:项目|案例|作品|系统)?(?:的|中|里)?第([一二三四五六七八九十\d]+)个/giu);
  return candidateRefs.size === 1 ? [...candidateRefs][0] ?? null : null;
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

function inheritFromTaskState(
  taskState: RouteChatTurnTaskState | null | undefined,
  previous: RouteAnchor | null | undefined,
  ledger: CapabilityLedger,
): ChatRouteDecision | null {
  if (!taskState) return null;
  if (taskState.status === 'completed') return null;
  const anchor: RouteAnchor = {
    turnId: taskState.lastSuccessfulTurnId ?? previous?.turnId ?? '',
    routeKind: 'grounded',
    reasonCode: 'task_state_topic',
    topicKind: taskState.topicKind,
    topicRef: taskState.topicRef,
  };
  const inherited = inheritRoute(anchor, ledger);
  if (!inherited) return null;
  return {
    ...inherited,
    reasonCode: `${inherited.reasonCode}_task_state`,
    inheritedFromTurnId: anchor.turnId || null,
  };
}

export function routeChatTurn(input: RouteChatTurnInput): ChatRouteDecision {
  const message = input.request.message.trim();
  const usablePrevious = input.previous?.previousTurnCompleted === false
    ? null
    : input.previous ?? null;
  if (isUnsafeOrUnverifiableRequest(message)) {
    return decision({
      routeKind: 'clarify',
      reasonCode: 'unsafe_or_unverifiable_request',
      safetyBoundary: 'unsafe_or_unverifiable_request',
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
  if (isProjectExperienceNarrativeQuestion(input.request)) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'project_experience_query',
      topicKind: 'project',
      topicRef: null,
      evidenceClass: 'direct',
      release: 'complete',
      requiresEmbedding: false,
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
  const projectCatalogReferent = usablePrevious && input.hasUsableHistory
    ? projectCatalogDiscourseReferent(message, usablePrevious)
    : null;
  if (usablePrevious && projectCatalogReferent) {
    return decision({
      routeKind: 'grounded',
      reasonCode: 'anaphoric_project_catalog_followup',
      topicKind: 'project',
      topicRef: projectCatalogReferent,
      evidenceClass: 'direct',
      inheritedFromTurnId: usablePrevious.turnId,
      release: 'complete',
      requiresEmbedding: true,
    });
  }
  if (isProjectFact(message)) {
    if (!projectTopic(message) && usablePrevious?.topicKind === 'project' && hasDeicticProjectReference(message)) {
      return inheritRoute(usablePrevious, input.ledger)!;
    }
    return decision({
      routeKind: 'grounded',
      reasonCode: 'project_fact_query',
      topicKind: 'project',
      topicRef: projectTopic(message),
      evidenceClass: 'direct',
      requiresEmbedding: true,
    });
  }
  if (usablePrevious && isExplicitCapabilityContinuation(message, usablePrevious, input.ledger)) {
    return inheritRoute(usablePrevious, input.ledger)!;
  }
  const capabilityImplementation = usablePrevious
    ? capabilityProjectFollowup(
        message,
        usablePrevious,
        input.ledger,
      )
    : null;
  if (capabilityImplementation) return capabilityImplementation;
  if (isStableGeneralConversation(message)) {
    return decision({
      routeKind: 'conversation',
      reasonCode: 'stable_general_conversation',
    });
  }
  if (isUnresolvedReference(message)) {
    const inherited = usablePrevious
      ? inheritRoute(usablePrevious, input.ledger)
      : null;
    if (inherited) return inherited;
    if (usablePrevious?.routeKind === 'conversation'
      && !isAcknowledgement(usablePrevious.question)
      && input.hasUsableHistory) {
      return decision({
        routeKind: 'conversation',
        reasonCode: 'anaphoric_conversation_followup',
        inheritedFromTurnId: usablePrevious.turnId,
      });
    }
    const taskStateInherited = inheritFromTaskState(
      input.taskState,
      input.previous,
      input.ledger,
    );
    if (taskStateInherited) return taskStateInherited;
    if (input.hasUsableHistory) {
      return decision({
        routeKind: 'conversation',
        reasonCode: 'anaphoric_conversation_followup',
        inheritedFromTurnId: usablePrevious?.turnId ?? null,
      });
    }
    return decision({
      routeKind: 'clarify',
      reasonCode: 'anaphoric_topic_unavailable',
    });
  }
  if (isPendingPersonalScopeClarification(input.previous)) {
    return decision({
      routeKind: 'conversation',
      reasonCode: 'clarification_followup',
      inheritedFromTurnId: input.previous.turnId,
    });
  }
  const inherited = usablePrevious ? inheritRoute(usablePrevious, input.ledger) : null;
  if (inherited) return inherited;
  return decision({
    routeKind: 'conversation',
    reasonCode: 'general_conversation_default',
  });
}
