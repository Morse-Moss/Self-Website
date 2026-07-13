import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { extractPublicKnowledge } from '../lib/server/public-knowledge.ts';

const contentPath = path.resolve('content/site-content.json');

function loadSiteContent() {
  return JSON.parse(fs.readFileSync(contentPath, 'utf8'));
}

test('extractPublicKnowledge produces the nine approved site-content documents', () => {
  const documents = extractPublicKnowledge(loadSiteContent());

  assert.deepEqual(
    documents.map(({ id, sourcePath }) => ({ id, sourcePath })),
    [
      { id: 'about', sourcePath: 'content/site-content.json#profile' },
      {
        id: 'project-content-agent',
        sourcePath: 'content/site-content.json#projects.content-agent',
      },
      {
        id: 'project-auto-operations',
        sourcePath: 'content/site-content.json#projects.auto-operations',
      },
      {
        id: 'project-deep-research',
        sourcePath: 'content/site-content.json#projects.deep-research',
      },
      {
        id: 'project-digital-morse',
        sourcePath: 'content/site-content.json#projects.digital-morse',
      },
      { id: 'faq-1', sourcePath: 'content/site-content.json#faq.1' },
      { id: 'faq-2', sourcePath: 'content/site-content.json#faq.2' },
      { id: 'faq-3', sourcePath: 'content/site-content.json#faq.3' },
      { id: 'faq-4', sourcePath: 'content/site-content.json#faq.4' },
    ],
  );
  assert.ok(documents.every((document) => document.title.length > 0));
  assert.ok(documents.every((document) => document.content.length > 0));
});

test('extractPublicKnowledge limits profile and project content to approved fields', () => {
  const content = loadSiteContent();
  const documents = extractPublicKnowledge(content);
  const about = documents.find((document) => document.id === 'about');

  assert.ok(about);
  assert.equal(
    about.content,
    [content.profile.role, content.profile.summary, ...content.profile.principles].join('\n\n'),
  );

  for (const project of content.projects) {
    const document = documents.find((item) => item.id === `project-${project.slug}`);

    assert.ok(document);
    assert.equal(document.title, project.name);
    assert.equal(
      document.content,
      [
        project.status,
        project.summary,
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

  const serialized = JSON.stringify(extractPublicKnowledge(content));

  assert.doesNotMatch(serialized, /content[\\/]drafts|[A-Za-z]:\\/i);
  assert.doesNotMatch(serialized, /generated-image\.png|生成图|截图待补/i);
  assert.doesNotMatch(serialized, /sanitization metadata|sanitization/i);
  assert.doesNotMatch(serialized, /无人值守运营|disabled-operation/i);
  assert.doesNotMatch(serialized, /\/works\/auto-operations\/login-workbench-2026-07-13\.png/i);
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
