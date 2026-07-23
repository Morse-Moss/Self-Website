import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  extractPublicKnowledge,
  publicKnowledgeHref,
} from '../lib/server/public-knowledge.ts';

const contentPath = path.resolve('content/site-content.json');

function loadSiteContent() {
  return JSON.parse(fs.readFileSync(contentPath, 'utf8'));
}

function expectedProjectDetails(project: any): string[] {
  if (project.details) {
    return [
      ...project.details.overview,
      `核心能力:\n${project.details.coreCapabilities.join('\n')}`,
      project.details.architecture.description,
      project.details.architecture.flow,
      `系统模块:\n${project.details.architecture.modules.join('\n')}`,
      project.details.implementation.summary,
      ...project.details.implementation.contributions,
      project.details.implementation.futureDirection,
    ].filter(Boolean);
  }

  return [
    project.caseStudy.problem,
    project.caseStudy.role,
    ...project.caseStudy.decisions,
    ...project.caseStudy.structure,
  ];
}

test('extractPublicKnowledge produces the approved site-content and project topic documents', () => {
  const documents = extractPublicKnowledge(loadSiteContent());

  assert.deepEqual(
    documents.map(({ id, sourcePath, href }) => ({ id, sourcePath, href })),
    [
      { id: 'about', sourcePath: 'content/site-content.json#profile', href: '/' },
      {
        id: 'resume-facts',
        sourcePath: 'content/site-content.json#profile.resumeFacts',
        href: '/',
      },
      {
        id: 'project-content-agent',
        sourcePath: 'content/site-content.json#projects.content-agent',
        href: '/works#content-agent',
      },
      ...['overview', 'experience', 'models', 'engineering', 'role', 'roadmap'].map((topic) => ({
        id: `project-content-agent-${topic}`,
        sourcePath: `content/site-content.json#projects.content-agent.knowledge.${topic}`,
        href: '/works#content-agent',
      })),
      {
        id: 'project-auto-operations',
        sourcePath: 'content/site-content.json#projects.auto-operations',
        href: '/works#auto-operations',
      },
      ...['overview', 'workflow', 'architecture', 'engineering', 'role', 'roadmap'].map((topic) => ({
        id: `project-auto-operations-${topic}`,
        sourcePath: `content/site-content.json#projects.auto-operations.knowledge.${topic}`,
        href: '/works#auto-operations',
      })),
      {
        id: 'project-ai-leadgen',
        sourcePath: 'content/site-content.json#projects.ai-leadgen',
        href: '/works#ai-leadgen',
      },
      ...['overview', 'acquisition', 'scoring', 'collaboration', 'outreach', 'role'].map((topic) => ({
        id: `project-ai-leadgen-${topic}`,
        sourcePath: `content/site-content.json#projects.ai-leadgen.knowledge.${topic}`,
        href: '/works#ai-leadgen',
      })),
      {
        id: 'project-deep-research',
        sourcePath: 'content/site-content.json#projects.deep-research',
        href: '/works#deep-research',
      },
      ...['overview', 'workflow', 'architecture', 'engineering', 'role', 'roadmap'].map((topic) => ({
        id: `project-deep-research-${topic}`,
        sourcePath: `content/site-content.json#projects.deep-research.knowledge.${topic}`,
        href: '/works#deep-research',
      })),
      {
        id: 'project-digital-morse',
        sourcePath: 'content/site-content.json#projects.digital-morse',
        href: '/works#digital-morse',
      },
      ...['overview', 'workflows', 'knowledge', 'reliability', 'role', 'roadmap'].map((topic) => ({
        id: `project-digital-morse-${topic}`,
        sourcePath: `content/site-content.json#projects.digital-morse.knowledge.${topic}`,
        href: '/works#digital-morse',
      })),
      { id: 'faq-1', sourcePath: 'content/site-content.json#faq.1', href: '/' },
      { id: 'faq-2', sourcePath: 'content/site-content.json#faq.2', href: '/' },
      { id: 'faq-3', sourcePath: 'content/site-content.json#faq.3', href: '/' },
      { id: 'faq-4', sourcePath: 'content/site-content.json#faq.4', href: '/' },
    ],
  );
  assert.ok(documents.every((document) => document.title.length > 0));
  assert.ok(documents.every((document) => document.content.length > 0));
});

test('content-agent knowledge topics stay independently retrievable and share one case href', () => {
  const content = loadSiteContent();
  const project = content.projects.find((item: { slug: string }) => item.slug === 'content-agent');
  const documents = extractPublicKnowledge(content);

  assert.ok(project);
  for (const topic of project.knowledgeTopics) {
    const documentId = `project-content-agent-${topic.id}`;
    const document = documents.find((item) => item.id === documentId);

    assert.ok(document);
    assert.equal(document.title, `${project.name}：${topic.title}`);
    assert.equal(document.content, `${project.name}\n\n${topic.title}\n\n${topic.content}`);
    assert.equal(document.href, '/works#content-agent');
    assert.equal(publicKnowledgeHref(documentId), '/works#content-agent');
  }
});

test('AI leadgen knowledge topics stay independently retrievable and share one case href', () => {
  const content = loadSiteContent();
  const project = content.projects.find((item: { slug: string }) => item.slug === 'ai-leadgen');
  const documents = extractPublicKnowledge(content);

  assert.ok(project);
  assert.equal(project.knowledgeTopics.length, 6);
  for (const topic of project.knowledgeTopics) {
    const documentId = `project-ai-leadgen-${topic.id}`;
    const document = documents.find((item) => item.id === documentId);

    assert.ok(document);
    assert.equal(document.title, `${project.name}：${topic.title}`);
    assert.equal(document.content, `${project.name}\n\n${topic.title}\n\n${topic.content}`);
    assert.equal(document.href, '/works#ai-leadgen');
    assert.equal(publicKnowledgeHref(documentId), '/works#ai-leadgen');
  }
});

test('digital-Morse knowledge topics stay independently retrievable and share one case href', () => {
  const content = loadSiteContent();
  const project = content.projects.find((item: { slug: string }) => item.slug === 'digital-morse');
  const documents = extractPublicKnowledge(content);

  assert.ok(project);
  assert.equal(project.knowledgeTopics.length, 6);
  for (const topic of project.knowledgeTopics) {
    const documentId = `project-digital-morse-${topic.id}`;
    const document = documents.find((item) => item.id === documentId);

    assert.ok(document);
    assert.equal(document.title, `${project.name}：${topic.title}`);
    assert.equal(document.content, `${project.name}\n\n${topic.title}\n\n${topic.content}`);
    assert.equal(document.href, '/works#digital-morse');
    assert.equal(publicKnowledgeHref(documentId), '/works#digital-morse');
  }
});

test('deep-research knowledge topics stay independently retrievable and share one case href', () => {
  const content = loadSiteContent();
  const project = content.projects.find((item: { slug: string }) => item.slug === 'deep-research');
  const documents = extractPublicKnowledge(content);

  assert.ok(project);
  assert.equal(project.knowledgeTopics.length, 6);
  for (const topic of project.knowledgeTopics) {
    const documentId = `project-deep-research-${topic.id}`;
    const document = documents.find((item) => item.id === documentId);

    assert.ok(document);
    assert.equal(document.title, `${project.name}：${topic.title}`);
    assert.equal(document.content, `${project.name}\n\n${topic.title}\n\n${topic.content}`);
    assert.equal(document.href, '/works#deep-research');
    assert.equal(publicKnowledgeHref(documentId), '/works#deep-research');
  }
});

test('deep-research public knowledge leads with approved value and implementation facts', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const document = documents.find((item) => item.id === 'project-deep-research');

  assert.ok(document);
  assert.match(document.content, /方法发现.*证据采集.*横纵分析/);
  assert.match(document.content, /项目负责人/);
  assert.match(document.content, /人工发布审批/);
  assert.doesNotMatch(document.content, /开源项目|验证证据|当前边界|采集时间|提交版本/);
});

test('extractPublicKnowledge limits profile and project content to approved fields', () => {
  const content = loadSiteContent();
  const documents = extractPublicKnowledge(content);
  const about = documents.find((document) => document.id === 'about');

  assert.ok(about);
  assert.equal(
    about.content,
    [
      content.profile.title,
      content.profile.role,
      content.profile.summary,
      `Morse 的工作原则、事实边界与安全边界:\n${content.profile.principles.join('\n')}`,
    ].join('\n\n'),
  );

  for (const project of content.projects) {
    const document = documents.find((item) => item.id === `project-${project.slug}`);

    assert.ok(document);
    assert.ok(Array.isArray(project.capabilities));
    assert.ok(Array.isArray(project.techStack));
    assert.equal(document.title, project.name);
    assert.equal(
      document.content,
      [
        project.name,
        project.status,
        project.summary,
        `能力:\n${project.capabilities.join('\n')}`,
        ...project.techStack.map(
          (group: { label: string; items: string[] }) =>
            `${group.label}:\n${group.items.join('\n')}`,
        ),
        ...expectedProjectDetails(project),
      ].join('\n\n'),
    );
  }
});

test('extracts only sanitized resume facts into a dedicated knowledge document', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const resume = documents.find((document) => document.id === 'resume-facts');

  assert.ok(resume);
  assert.equal(resume.sourcePath, 'content/site-content.json#profile.resumeFacts');
  assert.match(resume.content, /Claude Code/);
  assert.match(resume.content, /Codex/);
  assert.match(resume.content, /公司信息已脱敏/);
  assert.doesNotMatch(
    JSON.stringify(resume),
    /@|\+?\d[\d\s-]{7,}|身份证|住址|手机号|邮箱地址/iu,
  );
});

test('extractPublicKnowledge ignores private resume-shaped fields', () => {
  const content = loadSiteContent();
  const documents = extractPublicKnowledge({
    ...content,
    privateResume: {
      trustedPersonNote: 'SYNTHETIC_PRIVATE_RESUME_MARKER_7F42',
      storagePath: '/opt/revolution/shared/private/resume/private.morsepdf',
      table: 'resume_documents',
    },
  });
  assert.doesNotMatch(
    JSON.stringify(documents),
    /SYNTHETIC_PRIVATE_RESUME_MARKER_7F42|resume_documents|private[\\/]resume|trustedPersonNote/i,
  );
});

test('content-agent public knowledge leads with approved value and implementation facts', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const document = documents.find((item) => item.id === 'project-content-agent');

  assert.ok(document);
  assert.match(document.content, /企业局域网并投入使用/);
  assert.match(document.content, /GPT Image 2、Seedance 2、Kling、Veo、Wan/);
  assert.match(document.content, /项目负责人/);
  assert.match(document.content, /可审核、可回退的自进化 Agent/);
  assert.doesNotMatch(document.content, /验证证据|当前边界|采集时间|提交版本|脱敏处理/);
});

test('auto-operations public knowledge follows the approved controlled-workflow story', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const document = documents.find((item) => item.id === 'project-auto-operations');
  const topics = documents.filter((item) =>
    item.id.startsWith('project-auto-operations-'),
  );

  assert.ok(document);
  assert.equal(topics.length, 6);
  assert.match(document.content, /数据发现、内容沉淀、AI 内容生产/);
  assert.match(document.content, /AutoTask.*PublishJob/);
  assert.match(document.content, /项目负责人.*全部技术实现/);
  assert.match(topics.map((topic) => topic.content).join('\n'), /未来方向/);
  assert.doesNotMatch(
    [document.content, ...topics.map((topic) => topic.content)].join('\n'),
    /验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理|Railway|https?:\/\/|doubao|豆包|gpt-?\d|seed|kling|veo|wan/i,
  );
});

test('AI leadgen public knowledge keeps implemented scope precise', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const document = documents.find((item) => item.id === 'project-ai-leadgen');
  const topics = documents.filter((item) =>
    item.id.startsWith('project-ai-leadgen-'),
  );
  const serialized = JSON.stringify([document, ...topics]);

  assert.ok(document);
  assert.equal(topics.length, 6);
  assert.match(document.content, /线索入池.*官网信息补全.*AI 价值评分/);
  assert.match(document.content, /外部企业数据.*官网富化.*回信同步.*客户跟进/);
  assert.match(
    document.content,
    /统一线索状态串联评分记录、飞书提醒、发信任务和客户回信.*人工确认、邮箱健康检查和 Safe Send 校验.*回信自动关联原始发信记录/,
  );
  assert.match(serialized, /规则模板/);
  assert.match(serialized, /不是 AI 自动撰写/);
  assert.match(serialized, /不自动生成或发送客户回复/);
  assert.match(serialized, /不表述为生产部署或规模化获客成果/);
  assert.doesNotMatch(
    serialized,
    /已经接入 Apify|已经接入 Apollo|已经接入 WhatsApp|Google Maps 自动采集已完成|支持 AI 自动撰写开发信|AI 自动生成客户回复已完成|AI 自动发送客户回复已完成|已生产部署|已取得规模化获客|实现规模化获客/,
  );
});

test('digital-Morse public knowledge follows the approved resume story', () => {
  const documents = extractPublicKnowledge(loadSiteContent());
  const document = documents.find((item) => item.id === 'project-digital-morse');
  const topics = documents.filter((item) =>
    item.id.startsWith('project-digital-morse-'),
  );

  assert.ok(document);
  assert.equal(topics.length, 6);
  assert.match(document.content, /自由对话、JD 匹配和需求初诊/);
  assert.match(document.content, /BGE Embeddings.*pgvector/);
  assert.match(document.content, /项目负责人.*全部技术实现/);
  assert.match(topics.map((topic) => topic.content).join('\n'), /未来方向/);
  assert.doesNotMatch(
    [document.content, ...topics.map((topic) => topic.content)].join('\n'),
    /验证证据|当前边界|采集时间|提交版本|运行方式|脱敏处理|腾讯云|GPT-5\.4|BAAI\/bge-small/i,
  );
});

test('extractPublicKnowledge excludes drafts, paths, media, actions, and sanitization metadata', () => {
  const content = loadSiteContent();
  content.projects[0].media = {
    src: 'E:\\content\\drafts\\generated-image.png',
    caption: '生成图：截图待补',
    evidence: {
      sanitization: 'sanitization metadata',
    },
  };
  content.projects[0].actions = [
    {
      kind: 'external',
      label: '无人值守运营',
      href: 'https://example.com/disabled-operation',
    },
  ];

  const documents = extractPublicKnowledge(content);
  const serialized = JSON.stringify(documents);

  for (const document of documents) {
    assert.doesNotMatch(document.content, /content[\\/]drafts|[A-Za-z]:[\\/]/i);
  }
  assert.doesNotMatch(serialized, /generated-image\.png|截图待补/i);
  assert.doesNotMatch(serialized, /sanitization metadata|sanitization/i);
  assert.doesNotMatch(serialized, /无人值守运营|disabled-operation/i);
  assert.doesNotMatch(serialized, /\/works\/auto-operations\/login-workbench-2026-07-13\.png/i);

  const publicKnowledge = extractPublicKnowledge(loadSiteContent());
  const internalKnowledge = JSON.stringify(
    publicKnowledge.filter((document) =>
      document.id.startsWith('project-content-agent')
        || document.id.startsWith('project-auto-operations'),
    ),
  );
  assert.doesNotMatch(
    internalKnowledge,
    /https?:\/\/|Railway|login-workbench|capturedAt|commit|生产环境|\bRUNNING\b/i,
  );

  const autoOperationsKnowledge = JSON.stringify(
    publicKnowledge.filter((document) =>
      document.id.startsWith('project-auto-operations'),
    ),
  );
  assert.doesNotMatch(
    autoOperationsKnowledge,
    /doubao|豆包|gpt-?\d|seed|kling|veo|wan/i,
  );
});

test('extractPublicKnowledge includes all four FAQ questions and answers', () => {
  const content = loadSiteContent();
  const documents = extractPublicKnowledge(content);

  for (const [index, item] of content.faq.entries()) {
    const faq = documents.find((document) => document.id === `faq-${index + 1}`);

    assert.ok(faq);
    assert.equal(faq.title, item.question);
    assert.equal(faq.content, `${item.question}\n\n${item.answer}`);
  }
});
