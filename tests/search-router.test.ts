import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routeSearch } from '../lib/server/search-router.ts';

const baseInput = {
  question: '普通问题',
  searchEnabled: true,
  searchCount: 0,
  localEvidenceSufficient: false,
};

test('search router vetoes web search for Morse personal facts before every other rule', () => {
  assert.deepEqual(routeSearch({
    question: '请核验摩斯陈彦今天最新的工作经历',
    searchEnabled: true,
    searchCount: 0,
    localEvidenceSufficient: false,
  }), {
    shouldSearch: false,
    query: null,
    reason: 'personal_fact_veto',
  });

  for (const question of [
    '摩斯是谁？',
    '陈彦最近在做什么？',
    '你的名字和工作背景是什么？',
    'Who are you?',
    'What is your email?',
    '这个网站作者是谁？',
    '贵站作者的工作经历是什么？',
    '站长的联系方式是什么？',
    '你做过什么项目？',
    'What projects have you built?',
    'Tell me your latest project',
    'What is your personal email?',
    'Who is the website author?',
    "What is the site owner's email?",
    '请介绍一下你最新的项目',
    '你有哪些项目？',
    '你会什么技能？',
    '你开发过哪些系统？',
    'Which projects did you build?',
    'Tell me about the systems you developed',
    'Tell me about yourself',
    '介绍一下你自己',
    'What do you do?',
  ]) {
    assert.equal(routeSearch({
      ...baseInput,
      question,
    }).reason, 'personal_fact_veto', question);
  }
});

test('addressing Morse does not veto an unrelated current external question', () => {
  assert.deepEqual(routeSearch({
    ...baseInput,
    question: 'Morse，请查一下 OpenAI API 的最新版本',
  }), {
    shouldSearch: true,
    query: 'Morse，请查一下 OpenAI API 的最新版本',
    reason: 'recency',
  });
  assert.equal(routeSearch({
    ...baseInput,
    question: '请问 Morse，帮我核验 React 最新版本',
  }).reason, 'explicit_verification');

  for (const question of [
    '你帮我查一下外部 Agent 项目',
    '摩斯电码的最新标准是什么？',
    'OpenAI Morse API 的版本是什么？',
    '请核验这篇论文作者本人的最新回应',
  ]) {
    assert.equal(routeSearch({
      ...baseInput,
      question,
    }).shouldSearch, true, question);
  }
});

test('search router applies the frozen deterministic priority without a model call', () => {
  const cases = [
    {
      input: { ...baseInput, question: '请核验外部事实', searchEnabled: false, searchCount: 5, explicitVerification: true },
      expected: { shouldSearch: false, query: null, reason: 'disabled' },
    },
    {
      input: { ...baseInput, question: '请核验外部事实', searchCount: 5, explicitVerification: true },
      expected: { shouldSearch: false, query: null, reason: 'quota_exhausted' },
    },
    {
      input: { ...baseInput, question: '请核验 OpenAI 的这项声明', explicitVerification: true },
      expected: { shouldSearch: true, query: '请核验 OpenAI 的这项声明', reason: 'explicit_verification' },
    },
    {
      input: { ...baseInput, question: 'Next.js 今天的最新版本是什么？' },
      expected: { shouldSearch: true, query: 'Next.js 今天的最新版本是什么？', reason: 'recency' },
    },
    {
      input: { ...baseInput, question: '请给出 OpenAI API 官方文档' },
      expected: { shouldSearch: true, query: '请给出 OpenAI API 官方文档', reason: 'external_technical' },
    },
    {
      input: { ...baseInput, localEvidenceSufficient: true },
      expected: { shouldSearch: false, query: null, reason: 'local_sufficient' },
    },
    {
      input: baseInput,
      expected: { shouldSearch: true, query: '普通问题', reason: 'local_insufficient' },
    },
  ] as const;

  for (const { input, expected } of cases) {
    assert.deepEqual(routeSearch(input), expected);
  }
});
