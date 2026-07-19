import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAllProjects,
  getFeaturedProjects,
  getProjectBySlug,
  getProjectStaticParams,
  projectSlugs,
  siteContent,
} from "../lib/site-content.ts";

const expectedSlugs = [
  "content-agent",
  "auto-operations",
  "deep-research",
  "digital-morse",
] as const;

const expectedProjects = {
  "content-agent": {
    name: "内容创作 Agent 系统",
    status: "唯一开发者 · 企业局域网已投入使用",
    actions: [],
  },
  "auto-operations": {
    name: "自动运营 Agent 系统",
    status: "唯一开发者 · 已部署运行",
    actions: [],
  },
  "deep-research": {
    name: "深度研究 Agent 系统",
    status: "唯一开发者 · 核心研究链可用",
    actions: [
      {
        kind: "external",
        label: "GitHub",
        href: "https://github.com/Morse-Moss/Deep-research-sys",
      },
    ],
  },
  "digital-morse": {
    name: "数字摩斯",
    status: "唯一开发者 · 已上线 · 持续完善中",
    actions: [
      {
        kind: "external",
        label: "GitHub",
        href: "https://github.com/Morse-Moss/Self-Website",
      },
    ],
  },
} as const;

test("exports the exact project slugs and static params", () => {
  assert.deepEqual(projectSlugs, expectedSlugs);
  assert.deepEqual(
    getAllProjects().map((project) => project.slug),
    expectedSlugs,
  );
  assert.deepEqual(
    getProjectStaticParams(),
    expectedSlugs.map((slug) => ({ slug })),
  );
});

test("returns the featured public projects and undefined when missing", () => {
  assert.deepEqual(
    getFeaturedProjects().map((project) => project.slug),
    ["deep-research", "digital-morse"],
  );
  assert.equal(getProjectBySlug("missing-project"), undefined);
});

test("S9 publishes Morse identity and only public featured projects", () => {
  assert.equal(siteContent.profile.title, "Morse");
  assert.equal(
    siteContent.profile.role,
    "Agent 系统开发者 × AI Native 实践者",
  );
  assert.deepEqual(siteContent.home.featuredSlugs, [
    "deep-research",
    "digital-morse",
  ]);
  assert.deepEqual(
    siteContent.site.nav.map((item) => item.label),
    ["首页", "作品集"],
  );
  assert.deepEqual(siteContent.site.footer.links, [
    { label: "GitHub", href: "https://github.com/Morse-Moss" },
  ]);
});

test("internal projects have no external action and disclose approved design media", () => {
  for (const slug of ["content-agent", "auto-operations"]) {
    const project = getProjectBySlug(slug);
    assert.ok(project);
    assert.equal(project.disclosure, "internal-redacted");
    assert.deepEqual(project.actions, []);

    const serialized = JSON.stringify(project);
    assert.doesNotMatch(
      serialized,
      /https?:\/\/|Railway|login-workbench|生产环境|RUNNING/,
    );
  }

  const contentAgent = getProjectBySlug("content-agent");
  const autoOperations = getProjectBySlug("auto-operations");
  assert.ok(contentAgent?.media);
  assert.equal(
    contentAgent.media.src,
    "/works/content-agent/atelier-main-design-2026-07-18.jpg",
  );
  assert.equal(
    contentAgent.media.label,
    "界面设计稿 · 示例数据",
  );
  assert.match(contentAgent.media.caption, /设计图/);
  assert.match(contentAgent.media.caption, /不是生产运行截图/);
  assert.ok(autoOperations?.media);
  assert.equal(
    autoOperations.media.src,
    "/works/auto-operations/operations-workbench-design-2026-07-19.png",
  );
  assert.equal(autoOperations.media.label, "界面设计稿 · 示例数据");
  assert.match(autoOperations.media.caption, /示例数据/);
});

test("content agent leads with a concise operator pitch and solo technical delivery", () => {
  const project = getProjectBySlug("content-agent") as ReturnType<typeof getProjectBySlug> & {
    ownership?: string;
    futureDirection?: string;
    askMorse?: { label: string; prompt: string };
    knowledgeTopics?: Array<{ id: string; title: string; content: string }>;
    details?: {
      overview: string[];
      coreCapabilities: string[];
      architecture: { flow?: string; modules: string[] };
      implementation: {
        summary: string;
        contributions: string[];
        futureDirection?: string;
      };
    };
  };

  assert.ok(project);
  assert.equal(
    project.summary,
    "面向企业的多模态内容创作系统，通过 GPT 式对话生成图片和视频，并持续沉淀 Prompt、Skill 与数字资产。",
  );
  assert.ok(project.summary.length <= 90, "public project summary must stay quickly scannable");
  assert.equal(
    project.ownership,
    "项目需求、产品方向和部分创意来自真实业务对接；摩斯是项目唯一开发者，负责将这些需求完整实现为可运行系统。",
  );
  assert.match(project.futureDirection ?? "", /可审核、可回退的自进化 Agent/);
  assert.deepEqual(project.capabilities, [
    "GPT 式创作",
    "Prompt 沉淀",
    "Skill 复用",
    "多模型接入",
    "数字资产",
  ]);
  assert.deepEqual(project.askMorse, {
    label: "问数字摩斯",
    prompt: "请介绍内容创作 Agent 的对话式创作、多模型适配、异步任务与数字资产管理，以及摩斯独立完成的技术实现。",
  });
  assert.deepEqual(
    project.knowledgeTopics?.map((topic) => topic.id),
    ["overview", "experience", "models", "engineering", "role", "roadmap"],
  );
  assert.ok(project.knowledgeTopics?.every((topic) => topic.title && topic.content));
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 6);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 6);
  assert.match(project.details?.implementation.summary ?? "", /真实业务对接/);
  assert.match(project.details?.implementation.summary ?? "", /唯一开发者/);
  assert.doesNotMatch(
    project.details?.implementation.summary ?? "",
    /独自提出全部业务|独立完成产品设计/,
  );
});

test("auto operations publishes the approved controlled-workflow story", () => {
  const project = getProjectBySlug("auto-operations");

  assert.ok(project);
  assert.equal(
    project.summary,
    "面向企业运营团队的小红书智能运营系统，将数据发现、内容沉淀、AI 内容生产、发布校验和任务追踪连接成受控运营工作流。",
  );
  assert.ok(project.summary.length <= 90, "public project summary must stay quickly scannable");
  assert.equal(
    project.ownership,
    "业务需求、产品方向和部分创意来自真实业务对接；摩斯是项目唯一开发者，负责将这些输入完整实现为可运行系统。",
  );
  assert.match(project.futureDirection ?? "", /可审核、可回退的运营策略 Agent/);
  assert.deepEqual(project.capabilities, [
    "账号矩阵",
    "内容资产化",
    "AI 内容生产",
    "任务编排",
    "受控发布",
  ]);
  assert.deepEqual(project.askMorse, {
    label: "问数字摩斯",
    prompt: "请介绍自动运营 Agent 的账号矩阵、内容资产、AI 生产、任务编排与受控发布，以及摩斯独立完成的技术实现。",
  });
  assert.deepEqual(
    project.knowledgeTopics?.map((topic) => topic.title),
    ["项目定位与价值", "使用流程", "核心架构", "关键技术实现", "个人技术贡献", "未来方向"],
  );
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 6);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 7);
  assert.match(project.details?.implementation.summary ?? "", /真实业务对接/);
  assert.match(project.details?.implementation.summary ?? "", /唯一开发者/);

  const aiPlatform = project.techStack.find((group) => group.label === "AI 与平台");
  assert.deepEqual(aiPlatform?.items, [
    "模型能力路由",
    "OpenAI-compatible Adapter",
    "RunningHub 工作流",
    "XHS SDK / 签名适配",
  ]);
  assert.doesNotMatch(
    JSON.stringify({
      summary: project.summary,
      capabilities: project.capabilities,
      details: project.details,
      techStack: project.techStack,
      knowledgeTopics: project.knowledgeTopics,
    }),
    /doubao|豆包|gpt-?\d|seed|kling|veo|wan/i,
  );
});

test("deep research leads with the approved research and evidence-governance story", () => {
  const project = getProjectBySlug("deep-research");

  assert.ok(project);
  assert.equal(
    project.summary,
    "本地优先的多 Agent 深度研究与报告系统，围绕研究问题完成方法发现、证据采集、横纵分析、质量审查与正式报告生成。",
  );
  assert.equal(
    project.ownership,
    "项目方向与研究方法吸收实际使用反馈、架构评审和外部系统研究；摩斯是项目发起人和唯一开发者，负责全部技术实现。",
  );
  assert.deepEqual(project.capabilities, [
    "横纵研究",
    "证据台账",
    "论断映射",
    "缺口修复",
    "发布审批",
  ]);
  assert.deepEqual(
    project.knowledgeTopics?.map((topic) => topic.id),
    ["overview", "workflow", "architecture", "engineering", "role", "roadmap"],
  );
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 7);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 7);
  assert.match(project.details?.implementation.summary ?? "", /唯一开发者/);
  assert.match(project.details?.implementation.futureDirection ?? "", /未来方向|Agent OS/);
  assert.deepEqual(project.actions, [
    {
      kind: "external",
      label: "GitHub",
      href: "https://github.com/Morse-Moss/Deep-research-sys",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(project), /开源项目/);
});

test("every project has grouped stack and capability evidence", () => {
  for (const project of getAllProjects()) {
    assert.ok(Array.isArray(project.techStack));
    assert.ok(Array.isArray(project.capabilities));
    assert.ok(project.techStack.length >= 2);
    assert.ok(project.techStack.every((group) => group.items.length > 0));
    assert.ok(project.capabilities.length >= 2);
  }
});

test("keeps project names, statuses, and CTAs exact", () => {
  for (const slug of expectedSlugs) {
    const project = getProjectBySlug(slug);
    assert.ok(project);
    assert.equal(project.name, expectedProjects[slug].name);
    assert.equal(project.status, expectedProjects[slug].status);
    assert.deepEqual(project.actions, expectedProjects[slug].actions);
    assert.ok(project.actions.length <= 2);
  }
});

test("provides six case-study fields for every project", () => {
  for (const project of getAllProjects()) {
    assert.equal(Object.keys(project.caseStudy).length, 6);
    assert.match(project.caseStudy.role, /负责整个项目的开发/);
    for (const key of [
      "decisions",
      "structure",
      "evidence",
      "boundaries",
    ] as const) {
      assert.ok(project.caseStudy[key].length > 0);
      assert.ok(project.caseStudy[key].every((value) => value.trim().length > 0));
    }
    assert.ok(project.caseStudy.problem.trim().length > 0);
  }
});

test("publishes only the four separately approved project media assets", () => {
  const mediaProjects = getAllProjects().filter((project) => project.media);

  assert.deepEqual(
    mediaProjects.map((project) => project.slug),
    ["content-agent", "auto-operations", "deep-research", "digital-morse"],
  );
  assert.equal(mediaProjects[0]?.media?.width, 1280);
  assert.equal(mediaProjects[0]?.media?.height, 1486);
  assert.match(mediaProjects[0]?.media?.evidence.runMode ?? "", /非运行态/);
  assert.equal(mediaProjects[1]?.media?.width, 1440);
  assert.equal(mediaProjects[1]?.media?.height, 1080);
  assert.equal(mediaProjects[1]?.media?.label, "界面设计稿 · 示例数据");
  assert.equal(mediaProjects[2]?.media?.width, 1440);
  assert.equal(mediaProjects[2]?.media?.height, 1080);
  assert.equal(mediaProjects[2]?.media?.label, "运行界面 · 示例数据");
  assert.equal(mediaProjects[3]?.media?.width, 576);
  assert.equal(mediaProjects[3]?.media?.height, 648);
  assert.match(mediaProjects[3]?.media?.evidence.runMode ?? "", /本地 production build/);
  assert.equal(mediaProjects[3]?.media?.label, "产品界面 · 示例会话");
});

test("keeps the approved global copy and four FAQ topics", () => {
  assert.deepEqual(siteContent.site, {
    name: "数字生命摩斯",
    description: "摩斯的多页 AI 原生作品集与数字分身。",
    nav: [
      { label: "首页", href: "/" },
      { label: "作品集", href: "/works" },
    ],
    resumeMode: {
      storageKey: "morse.resumeMode",
      bodyClass: "resume-mode",
      toggleLabel: "简历模式",
      printLabel: "打印 / 存 PDF",
    },
    footer: {
      morse: "-- --- .-. ... .",
      statement: "数字摩斯在场，真人摩斯验收。",
      copyright: "© 2026 数字生命摩斯",
      links: [
        { label: "GitHub", href: "https://github.com/Morse-Moss" },
      ],
    },
  });
  assert.deepEqual(siteContent.profile.capabilities, [
    "Agent 系统",
    "RAG",
    "多 Agent",
    "全栈开发",
  ]);
  assert.equal(siteContent.faq.length, 4);
  assert.match(siteContent.faq[0].question, /技术栈/);
  assert.match(siteContent.faq[1].question, /AI native/i);
  assert.match(siteContent.faq[2].question, /职责/);
  assert.match(siteContent.faq[2].answer, /唯一开发者.*全部技术实现/);
  assert.match(siteContent.faq[2].answer, /业务需求.*沟通/);
  assert.match(siteContent.faq[3].question, /快速了解/);
});

test("publishes the Digital Morse live status without vendor-specific copy", () => {
  const project = getProjectBySlug("digital-morse");

  assert.ok(project);
  assert.equal(project.status, "唯一开发者 · 已上线 · 持续完善中");
  assert.doesNotMatch(
    JSON.stringify({
      status: project.status,
      details: project.details,
      knowledgeTopics: project.knowledgeTopics,
    }),
    /腾讯云|GPT-5\.4|BAAI\/bge-small/i,
  );
  assert.doesNotMatch(
    JSON.stringify(project),
    /网站尚未部署|真实 Provider 仅部分通过|不提供公开访问入口/,
  );
});

test("digital Morse leads with visitor value, solo delivery, and honest future scope", () => {
  const project = getProjectBySlug("digital-morse");

  assert.ok(project);
  assert.equal(
    project.summary,
    "嵌入个人作品集的 AI 数字分身系统，通过自由对话、JD 匹配和需求初诊，帮助访客快速了解项目与能力，并获得带来源的可追溯回答。",
  );
  assert.ok(project.summary.length <= 90, "public project summary must stay quickly scannable");
  assert.equal(
    project.ownership,
    "数字摩斯由摩斯发起；需求判断、产品方向和部分创意也会吸收招聘方、潜在客户、同行及真实业务沟通中的输入。摩斯是项目唯一开发者，负责全部技术实现。",
  );
  assert.match(project.futureDirection ?? "", /未来.*语音.*视频.*长期记忆.*人工审核/);
  assert.deepEqual(project.capabilities, [
    "三类对话工作流",
    "BGE + pgvector",
    "可追溯来源",
    "受控联网",
    "停止与恢复",
  ]);
  assert.ok(project.media);
  assert.equal(
    project.media.src,
    "/works/digital-morse/digital-morse-main-local-2026-07-19.png",
  );
  assert.equal(
    project.media.label,
    "产品界面 · 示例会话",
  );
  assert.deepEqual(project.askMorse, {
    label: "问数字摩斯",
    prompt: "请介绍数字摩斯的三种对话流程、RAG 与可靠性设计，以及摩斯独立完成的技术实现。",
  });
  assert.deepEqual(
    project.knowledgeTopics?.map((topic) => topic.id),
    ["overview", "workflows", "knowledge", "reliability", "role", "roadmap"],
  );
  assert.deepEqual(
    project.knowledgeTopics?.map((topic) => topic.title),
    ["项目定位与价值", "使用流程", "核心架构", "关键技术实现", "个人技术贡献", "未来方向"],
  );
  assert.equal(project.details?.overview.length, 2);
  assert.equal(project.details?.coreCapabilities.length, 6);
  assert.equal(project.details?.architecture.modules.length, 5);
  assert.equal(project.details?.implementation.contributions.length, 6);
  assert.match(project.details?.implementation.summary ?? "", /唯一开发者.*全部技术实现/);
  assert.match(project.details?.implementation.summary ?? "", /真实业务沟通/);
  assert.match(project.details?.implementation.futureDirection ?? "", /语音.*视频.*长期记忆.*人工审核/);
  assert.doesNotMatch(
    JSON.stringify({
      summary: project.summary,
      status: project.status,
      capabilities: project.capabilities,
      details: project.details,
      knowledgeTopics: project.knowledgeTopics,
    }),
    /验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理|腾讯云|GPT-5\.4|BAAI\/bge-small/i,
  );
});

test("keeps all public JSON free of placeholders and private-source leakage", () => {
  const source = readFileSync(
    new URL("../content/site-content.json", import.meta.url),
    "utf8",
  );
  const banned = [
    /"href"\s*:\s*"#"/i,
    /Email|WeChat/i,
    /content[\\/]drafts/i,
    /[A-Z]:\\/i,
    /output[\\/]system-captures/i,
    /imagegen/i,
    /Mock Provider/i,
    /访问系统/,
    /节省工时|增长率|产能提升/,
  ];

  for (const pattern of banned) {
    assert.doesNotMatch(source, pattern);
  }
  assert.equal(siteContent.projects.length, 4);
});
