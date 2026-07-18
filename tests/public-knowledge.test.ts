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

test('extractPublicKnowledge produces the approved site-content and content-agent topic documents', () => {
  const documents = extractPublicKnowledge(loadSiteContent());

  assert.deepEqual(
    documents.map(({ id, sourcePath, href }) => ({ id, sourcePath, href })),
    [
      { id: 'about', sourcePath: 'content/site-content.json#profile', href: '/' },
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
      {
        id: 'project-deep-research',
        sourcePath: 'content/site-content.json#projects.deep-research',
        href: '/works#deep-research',
      },
      {
        id: 'project-digital-morse',
        sourcePath: 'content/site-content.json#projects.digital-morse',
        href: '/works#digital-morse',
      },
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
        project.caseStudy.problem,
        project.caseStudy.role,
        ...project.caseStudy.decisions,
        ...project.caseStudy.structure,
        ...project.caseStudy.evidence,
        ...project.caseStudy.boundaries,
      ].join('\n\n'),
    );
  }
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

  const internalKnowledge = JSON.stringify(
    extractPublicKnowledge(loadSiteContent()).filter((document) =>
      document.id.startsWith('project-content-agent')
        || document.id === 'project-auto-operations',
    ),
  );
  assert.doesNotMatch(
    internalKnowledge,
    /https?:\/\/|Railway|login-workbench|capturedAt|commit|生产环境|内网已部署|RUNNING/,
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
