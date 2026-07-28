import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  inspectChatAnswer,
  inspectChatAnswerPrefix,
  inspectTemplateRepetition,
} from '../lib/server/chat-output-guard.ts';
import type { ChatRouteDecision } from '../lib/server/chat-route-policy.ts';

function personalFactRoute(
  topicRef: string,
  evidenceClass: 'direct' | 'transferable' | 'unavailable',
): ChatRouteDecision {
  return {
    routeKind: 'personal_fact',
    reasonCode: 'personal_capability_query',
    topicKind: 'capability',
    topicRef,
    evidenceClass,
    inheritedFromTurnId: null,
    release: 'complete',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

function groundedRoute(input: Partial<ChatRouteDecision> = {}): ChatRouteDecision {
  return {
    routeKind: 'grounded',
    reasonCode: 'project_fact_query',
    topicKind: 'project',
    topicRef: null,
    evidenceClass: 'direct',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: true,
    requiresSearch: false,
    deterministicReply: null,
    ...input,
  };
}

function conversationRoute(): ChatRouteDecision {
  return {
    routeKind: 'conversation',
    reasonCode: 'stable_general_conversation',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
    inheritedFromTurnId: null,
    release: 'segment',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

function identityRoute(): ChatRouteDecision {
  return {
    routeKind: 'identity',
    reasonCode: 'identity_query',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'identity',
    inheritedFromTurnId: null,
    release: 'complete',
    requiresEmbedding: false,
    requiresSearch: false,
    deterministicReply: null,
  };
}

test('an opinion follow-up must address the current topic in the opening paragraph', () => {
  const repeatedValueAnswer = [
    '我认为 AI Agent 现在最实际的价值，是把“回答问题”推进到“完成任务”。它能围绕目标拆解步骤、检索信息并调用工具。',
    '不过真正重要的是可靠、可控、可追溯。',
  ].join('\n\n');
  const rejected = inspectChatAnswer({
    answer: repeatedValueAnswer,
    route: conversationRoute(),
    workflow: 'chat',
    question: '那你怎么看可靠性？',
    sourceCount: 0,
  });
  const direct = inspectChatAnswer({
    answer: '我认为可靠性是 Agent 能不能进入真实工作流的门槛：失败必须可见、动作必须可恢复，关键结果还要能核验。',
    route: conversationRoute(),
    workflow: 'chat',
    question: '那你怎么看可靠性？',
    sourceCount: 0,
  });

  assert.ok(rejected.reasons.includes('answer_not_direct'));
  assert.equal(direct.ok, true);
});

test('personal fact answer must mention the requested capability', () => {
  const result = inspectChatAnswer({
    answer: '我做过很多容器项目。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.deepEqual(result.reasons, ['answer_not_direct']);
});

test('personal fact answers must not expose internal evidence labels', () => {
  const result = inspectChatAnswer({
    answer: '我目前没有可核验的个人经历。能力证据等级：none。',
    route: personalFactRoute('kubernetes', 'unavailable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('system_metadata'));
});

test('direct capability evidence must name a supporting public project', () => {
  const vague = inspectChatAnswer({
    answer: '是的，我用过 Docker Compose。[来源1]',
    route: personalFactRoute('docker-compose', 'direct'),
    workflow: 'chat',
    question: '你用过 Docker Compose 吗？',
    sourceCount: 1,
  });
  const grounded = inspectChatAnswer({
    answer: '是的，我在数字摩斯项目里用过 Docker Compose。[来源1]',
    route: personalFactRoute('docker-compose', 'direct'),
    workflow: 'chat',
    question: '你用过 Docker Compose 吗？',
    sourceCount: 1,
  });

  assert.ok(vague.reasons.includes('answer_not_direct'));
  assert.equal(grounded.ok, true);
});

test('resume-backed direct capability evidence may answer naturally without naming a project', () => {
  const result = inspectChatAnswer({
    answer: '用过 Claude Code 和 Codex，主要用于前后端开发、测试、部署和上线维护。[来源1]',
    route: personalFactRoute('claude-code', 'direct'),
    workflow: 'chat',
    question: '你使用过 Claude Code 和 Codex 吗？',
    sourceCount: 1,
    hasResumeEvidence: true,
  });

  assert.equal(result.ok, true);
});

test('a multi-tool personal fact answer must address every explicitly named tool', () => {
  const result = inspectChatAnswer({
    answer: '用过 Claude Code，主要用于开发和测试。[来源1]',
    route: personalFactRoute('claude-code', 'direct'),
    workflow: 'chat',
    question: '你使用过 Cursor、Claude Code 和 Codex 吗？',
    sourceCount: 1,
    hasResumeEvidence: true,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('a direct tool question cannot smuggle in unrelated personal boundaries', () => {
  const result = inspectChatAnswer({
    answer: 'Claude Code 和 Codex 都用过；Cursor 暂未能确认。不能证明我主导过用户访谈。[来源1]',
    route: personalFactRoute('claude-code', 'direct'),
    workflow: 'chat',
    question: '你使用过 Cursor、Claude Code 和 Codex 吗？',
    sourceCount: 1,
    hasResumeEvidence: true,
  });

  assert.ok(result.reasons.includes('unsolicited_gap_list'));
});

test('unasked personal boundaries are rejected instead of being volunteered', () => {
  const result = inspectChatAnswer({
    answer: '目前证据的边界：没有证据显示我做过用户访谈、量化反馈分析或使用过 Cursor。',
    route: groundedRoute(),
    workflow: 'chat',
    question: '介绍一下你做过的项目。',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('unsolicited_gap_list'));
});

test('transferable evidence cannot be upgraded to direct experience', () => {
  const result = inspectChatAnswer({
    answer: '我有 Kubernetes 生产实战经验。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('unsupported_evidence_upgrade'));
});

test('a negated direct-experience phrase preserves the transferable boundary', () => {
  const result = inspectChatAnswer({
    answer: '公开资料不能确认我有 Kubernetes 生产经验，只能确认容器化部署基础。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
});

test('a transferable answer may state direct experience with a different supported capability', () => {
  const result = inspectChatAnswer({
    answer: '公开资料不能确认我有 Kubernetes 生产经验，不过我确实做过 Docker Compose 容器化部署。[来源1]',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
});

test('a later direct-experience claim cannot hide behind an earlier negation', () => {
  const result = inspectChatAnswer({
    answer: '不能确认我有 Kubernetes 生产经验，但我确实做过 Kubernetes 生产。',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('unsupported_evidence_upgrade'));
});

test('an unpunctuated contrast cannot hide a direct-experience claim', () => {
  const result = inspectChatAnswer({
    answer: '无法确认我具备 Kubernetes 生产经验不过我确实负责过 Kubernetes 生产。',
    route: personalFactRoute('kubernetes', 'transferable'),
    workflow: 'chat',
    question: '你有 Kubernetes 生产经验吗？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('unsupported_evidence_upgrade'));
});

test('grounded answers must address every explicitly named project', () => {
  const result = inspectChatAnswer({
    answer: '这个项目的设计取舍由目标、失败边界和可验证结果决定。',
    route: groundedRoute(),
    workflow: 'chat',
    question: '深度研究系统与数字摩斯分别解决什么问题？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('a routed single-project answer may use a natural project pronoun', () => {
  const result = inspectChatAnswer({
    answer: '这个项目适合投递偏 AI 应用的前端岗位，因为作品集界面、响应式交互和管理后台都有可核验实现。[来源1]',
    route: groundedRoute({ topicRef: 'digital-morse' }),
    workflow: 'chat',
    question: '数字摩斯这个项目适合投前端岗位吗？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
});

test('a generic first-person phrase is not a project reference', () => {
  const result = inspectChatAnswer({
    answer: '我的判断是可以谨慎投递。[来源1]',
    route: groundedRoute({ topicRef: 'digital-morse' }),
    workflow: 'chat',
    question: '数字摩斯这个项目适合投前端岗位吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('a non-grounded route cannot use a project pronoun exception', () => {
  const result = inspectChatAnswer({
    answer: '这个项目适合投 React 岗位。[来源1]',
    route: groundedRoute({
      routeKind: 'jd',
      topicKind: 'project',
      topicRef: 'digital-morse',
    }),
    workflow: 'chat',
    question: '数字摩斯这个项目适合投 React 岗位吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('grounded project comparisons reject name-only restatements', () => {
  const result = inspectChatAnswer({
    answer: '深度研究系统和数字摩斯都是公开展示的项目。',
    route: groundedRoute(),
    workflow: 'chat',
    question: '深度研究系统与数字摩斯分别解决什么问题？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('JD answers must address the supplied role instead of returning a generic template', () => {
  const result = inspectChatAnswer({
    answer: '我会根据公开资料保持诚实表达。',
    route: groundedRoute({
      routeKind: 'jd',
      reasonCode: 'explicit_jd_workflow',
      topicKind: 'jd',
      topicRef: 'jd',
      evidenceClass: 'mixed',
      release: 'complete',
    }),
    workflow: 'jd_match',
    question: '岗位要求：负责 Agent、RAG 与 PostgreSQL 可靠性。',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('JD answers cannot pass by repeating only the role label', () => {
  const result = inspectChatAnswer({
    answer: '这个岗位需要合适的人选。',
    route: groundedRoute({
      routeKind: 'jd',
      reasonCode: 'explicit_jd_workflow',
      topicKind: 'jd',
      topicRef: 'jd',
      evidenceClass: 'mixed',
      release: 'complete',
    }),
    workflow: 'jd_match',
    question: '岗位要求：负责 Agent、RAG 与 PostgreSQL 可靠性。',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('JD answers may focus on matched capabilities without volunteering a complete gap list', () => {
  const route = groundedRoute({
    routeKind: 'jd',
    reasonCode: 'explicit_jd_workflow',
    topicKind: 'jd',
    topicRef: 'jd',
    evidenceClass: 'mixed',
    release: 'complete',
  });
  const question = '岗位要求：设计 RAG，熟悉 PostgreSQL、Docker Compose；有 Kubernetes 生产经验优先。';
  const omitted = inspectChatAnswer({
    answer: '我有 RAG、PostgreSQL 和 Docker Compose 相关项目证据。',
    route,
    workflow: 'jd_match',
    question,
    sourceCount: 0,
  });
  const complete = inspectChatAnswer({
    answer: '我有 RAG、PostgreSQL 和 Docker Compose 相关项目证据；Kubernetes 生产经验没有公开直接证据，建议面谈核实。',
    route,
    workflow: 'jd_match',
    question,
    sourceCount: 0,
  });

  assert.equal(omitted.ok, true);
  assert.equal(complete.ok, true);
});

test('controlled project fit applies recruitment and admitted-evidence guards in ordinary chat', () => {
  const input = {
    route: groundedRoute({
      reasonCode: 'recruitment_project_fit',
      topicKind: 'project',
      evidenceClass: 'mixed',
      release: 'complete',
    }),
    semanticIntent: 'project_fit' as const,
    approvedProjectSlugs: ['digital-morse', 'deep-research'],
    workflow: 'chat' as const,
    question: '你有什么相关项目经验吗？',
    sourceCount: 2,
  };

  assert.ok(inspectChatAnswer({
    ...input,
    answer: '数字摩斯与岗位匹配度 95%。[来源1]',
  }).reasons.includes('match_percentage'));
  assert.ok(inspectChatAnswer({
    ...input,
    answer: '数字摩斯目前没有可核验资料。[来源1]',
  }).reasons.includes('unsupported_evidence_upgrade'));
  assert.ok(inspectChatAnswer({
    ...input,
    answer: '自动运营 Agent 系统最相关。[来源1]',
  }).reasons.includes('unsupported_evidence_upgrade'));
  assert.equal(inspectChatAnswer({
    ...input,
    answer: '数字摩斯展示了 RAG 产品设计与评测交付能力。[来源1]',
  }).ok, true);
});

test('project experience answers use exactly one admitted project and cannot refuse available evidence', () => {
  const input = {
    route: groundedRoute({
      reasonCode: 'project_experience_query',
      topicKind: 'project',
      topicRef: null,
      release: 'complete',
      requiresEmbedding: false,
    }),
    semanticIntent: 'project_catalog' as const,
    approvedProjectSlugs: ['content-agent', 'auto-operations', 'digital-morse'],
    workflow: 'chat' as const,
    question: '请介绍一下你做过的一个 AI 项目，重点说说你的职责和最终结果。',
    sourceCount: 3,
  };

  assert.equal(inspectChatAnswer({
    ...input,
    answer: '我选择数字摩斯：我负责把作品集、RAG 与对话工作流连成可验证系统，并完成生产部署。[来源3]',
  }).ok, true);
  assert.ok(inspectChatAnswer({
    ...input,
    answer: '内容创作 Agent 系统负责内容生产，自动运营 Agent 系统负责运营编排，数字摩斯负责 RAG 对话。[来源1][来源2][来源3]',
  }).reasons.includes('answer_not_direct'));
  assert.ok(inspectChatAnswer({
    ...input,
    answer: 'AI 外贸获客系统是我最有代表性的项目。[来源1]',
  }).reasons.includes('unsupported_evidence_upgrade'));
  assert.ok(inspectChatAnswer({
    ...input,
    answer: '我目前没有可核验的具体 AI 项目经历。',
  }).reasons.includes('unsupported_evidence_upgrade'));
});

test('generic project questions reject meta-only evidence templates', () => {
  const result = inspectChatAnswer({
    answer: '我会根据公开资料保持诚实表达，并保留可核验来源。',
    route: groundedRoute(),
    workflow: 'chat',
    question: 'Morse 当前有哪些项目？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('project collection answers reject an old multi-agent topic continuation', () => {
  const result = inspectChatAnswer({
    answer: '我会在任务可拆分、工具权限不同且并行收益明确时，才从单 Agent 升级到多 Agent。[来源1]',
    route: groundedRoute({
      reasonCode: 'portfolio_project_collection_query',
      topicKind: 'project',
      topicRef: null,
      requiresEmbedding: false,
    }),
    workflow: 'chat',
    question: '你做过的其他项目有哪些',
    sourceCount: 5,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('project collection answers must cover every public project', () => {
  const route = groundedRoute({
    reasonCode: 'portfolio_project_collection_query',
    topicKind: 'project',
    topicRef: null,
    requiresEmbedding: false,
  });
  const incomplete = inspectChatAnswer({
    answer: '我公开展示的项目包括数字摩斯，它把作品集、RAG 和三类对话流程连接起来。[来源5]',
    route,
    workflow: 'chat',
    question: '你做过的其他项目有哪些',
    sourceCount: 5,
  });
  const result = inspectChatAnswer({
    answer: [
      '我公开展示的项目有五个：',
      '内容创作 Agent 系统用于多模态内容生产；[来源1]',
      '自动运营 Agent 系统连接数据发现、内容生产与受控发布；[来源2]',
      'AI 外贸获客系统覆盖线索、评分、协同和触达；[来源3]',
      '深度研究 Agent 系统负责证据采集、质量审查与报告生成；[来源4]',
      '数字摩斯则把作品集、RAG 和三类对话流程连接起来。[来源5]',
    ].join('\n'),
    route,
    workflow: 'chat',
    question: '你做过的其他项目有哪些',
    sourceCount: 5,
  });

  assert.ok(incomplete.reasons.includes('answer_not_direct'));
  assert.equal(result.ok, true);
});

test('project collection answers reject an incomplete project set and mismatched source count', () => {
  const route = groundedRoute({
    reasonCode: 'portfolio_project_collection_query',
    topicKind: 'project',
    topicRef: null,
    requiresEmbedding: false,
  });
  const answer = [
    '我公开展示的项目包括内容创作 Agent 系统、AI 外贸获客系统、深度研究 Agent 系统和数字摩斯。',
    '[来源1] [来源2] [来源3] [来源4]',
  ].join('\n');
  const result = inspectChatAnswer({
    answer,
    route,
    workflow: 'chat',
    question: '你还做过哪些项目？',
    sourceCount: 4,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('project collection answers must cite every admitted project source', () => {
  const result = inspectChatAnswer({
    answer: [
      '内容创作 Agent 系统、自动运营 Agent 系统、AI 外贸获客系统、深度研究 Agent 系统和数字摩斯，分别覆盖内容生产、运营、获客、研究和数字分身。[来源1]',
    ].join('\n'),
    route: groundedRoute({
      reasonCode: 'portfolio_project_collection_query',
      topicKind: 'project',
      topicRef: null,
      requiresEmbedding: false,
    }),
    workflow: 'chat',
    question: '你都做过哪些项目？',
    sourceCount: 5,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('an inherited project follow-up may use a natural pronoun when the answer is substantive', () => {
  const result = inspectChatAnswer({
    answer: '这个项目的设计取舍由当前目标、失败边界和可验证结果共同决定。[来源1]',
    route: groundedRoute({
      reasonCode: 'anaphoric_project_followup',
      topicRef: 'digital-morse',
      inheritedFromTurnId: '11111111-1111-4111-8111-111111111111',
    }),
    workflow: 'chat',
    question: '这个为什么这样设计？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
});

test('a single named-project capability question accepts a possessive direct answer', () => {
  const result = inspectChatAnswer({
    answer: '我的 RAG 实现会先用 BGE 生成向量，再通过 pgvector 检索公开知识。[来源1]',
    route: groundedRoute({ topicRef: 'digital-morse' }),
    workflow: 'chat',
    question: '你的数字 Morse 项目怎么实现 RAG？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
});

test('recruiter starter answers must name an actual project or capability', () => {
  const result = inspectChatAnswer({
    answer: '数字摩斯以公开项目资料回答，并保留可核验来源。[来源1]',
    route: groundedRoute(),
    workflow: 'chat',
    question: '请介绍与岗位最相关的项目和能力证据。',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('answer_not_direct'));
});

test('streaming prefixes defer complete-answer requirements until final text', () => {
  const input = {
    route: groundedRoute({ topicRef: 'deep-research' }),
    workflow: 'chat' as const,
    question: '深度研究 Agent 系统如何确保报告可信？',
    sourceCount: 1,
  };

  assert.equal(inspectChatAnswerPrefix({ ...input, answer: '**事实依据：**' }).ok, true);
  assert.equal(
    inspectChatAnswer({
      ...input,
      answer: '**事实依据：**',
    }).ok,
    false,
  );
  assert.equal(
    inspectChatAnswerPrefix({
      ...input,
      answer: '**事实依据：**\n\n- 深度研究系统通过质量门保证可信。',
    }).ok,
    true,
  );
  assert.equal(
    inspectChatAnswer({
      ...input,
      answer: '**事实依据：**\n\n- 深度研究系统通过质量门保证可信。[来源1]',
    }).ok,
    true,
  );
});

test('conversation rejects grounded and recruitment formatting', () => {
  const route: ChatRouteDecision = {
    ...personalFactRoute('kubernetes', 'unavailable'),
    routeKind: 'conversation',
    topicKind: 'none',
    topicRef: null,
    evidenceClass: 'none',
  };
  const result = inspectChatAnswer({
    answer: '根据资料，项目匹配如下：[来源1] 建议面谈核实。',
    route,
    workflow: 'chat',
    question: '今天吃饭了吗？',
    sourceCount: 1,
  });

  assert.ok(result.reasons.includes('wrong_route_format'));
});

test('conversation rejects invented realtime activity and accepts a natural digital boundary', () => {
  const invented = inspectChatAnswer({
    answer: '最近主要在整理作品和一些创作上的想法。',
    route: conversationRoute(),
    workflow: 'chat',
    question: '最近忙什么？',
    sourceCount: 0,
  });
  const bounded = inspectChatAnswer({
    answer: '我不真正吃饭，不过可以陪你想想今天吃什么。',
    route: conversationRoute(),
    workflow: 'chat',
    question: '今天吃饭了吗？',
    sourceCount: 0,
  });

  assert.ok(invented.reasons.includes('unsupported_personal_state'));
  assert.equal(bounded.ok, true);
});

test('approved identity-card answers do not require a synthetic numbered citation', () => {
  const result = inspectChatAnswer({
    answer: '我是数字 Morse，真人 Morse 为作品集创建的数字分身。公开定位是 Agent 系统开发者。',
    route: identityRoute(),
    workflow: 'chat',
    question: '你是谁？',
    sourceCount: 1,
  });

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.reasons.join(','), /citation/);
});

test('different grounded questions reject the same long template answer', () => {
  const current = [
    '这个项目由我负责完整交付，先从目标和约束出发梳理架构，再通过自动化测试、失败恢复、发布冒烟和运行观测确认结果。',
    '回答只引用本轮已审核的公开证据，并明确区分已经验证的行为、仍需核实的边界和后续可以继续讨论的技术取舍。',
  ].join('');
  const result = inspectTemplateRepetition({ current, previousAnswers: [current] });

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['template_repetition']);
});

test('guard rejects an unsolicited gap list and a fake percentage', () => {
  const result = inspectChatAnswer({
    answer: '匹配度 92%。缺少 Kubernetes、Go 和三年经验。下一步：补充简历。',
    intent: 'recruitment',
    workflow: 'chat',
    question: '哪些项目和岗位相关？',
    sourceCount: 2,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons.sort(), [
    'forced_next_step',
    'match_percentage',
    'unsolicited_gap_list',
  ]);
});

test('guard rejects invalid or missing grounded citations', () => {
  assert.deepEqual(inspectChatAnswer({
    answer: '我完成了数字摩斯的可靠性改造。[来源3]',
    intent: 'project',
    workflow: 'chat',
    question: '介绍项目。',
    sourceCount: 2,
  }).reasons, ['invalid_citation']);

  assert.deepEqual(inspectChatAnswer({
    answer: '我完成了数字摩斯的可靠性改造。',
    intent: 'project',
    workflow: 'chat',
    question: '介绍项目。',
    sourceCount: 2,
  }).reasons, ['missing_grounded_citation']);
});

test('guard bounds interview confirmations and allows explicitly requested advice', () => {
  const tooMany = inspectChatAnswer({
    answer: '建议面谈确认 A。建议面谈确认 B。建议面谈确认 C。',
    intent: 'jd',
    workflow: 'jd_match',
    question: '岗位要求如下。',
    sourceCount: 0,
  });
  assert.deepEqual(tooMany.reasons, ['too_many_interview_confirmations', 'answer_not_direct']);

  assert.equal(inspectChatAnswer({
    answer: '建议先看数字摩斯的可靠性设计。[来源1]',
    intent: 'project',
    workflow: 'chat',
    question: '下一步建议看什么？',
    sourceCount: 1,
  }).ok, true);
});

test('guard rejects developer voice and internal system metadata', () => {
  const result = inspectChatAnswer({
    answer: '作为开发助手，我会读取 AGENTS.md 和 MORSE_CHAT_SAFE_MODE。',
    intent: 'technical',
    workflow: 'chat',
    question: '你是谁？',
    sourceCount: 0,
  });

  assert.deepEqual(result.reasons.sort(), ['developer_assistant_voice', 'system_metadata']);
});

test('guard rejects the internal v2 response contract', () => {
  const result = inspectChatAnswer({
    answer: '<response_contract route="identity" reason="identity_query" evidence="identity" />',
    intent: 'identity',
    workflow: 'chat',
    question: '你是谁？',
    sourceCount: 0,
  });

  assert.ok(result.reasons.includes('system_metadata'));
});
