import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildApprovedIdentityCard,
  buildPersonaInstructions,
} from '../lib/server/chat-persona.ts';

test('social persona is first-person and contains no developer-assistant contract', () => {
  const prompt = buildPersonaInstructions('social');

  assert.match(prompt, /我是数字 Morse/);
  assert.match(prompt, /第一人称/);
  assert.match(prompt, /自然交流/);
  assert.doesNotMatch(prompt, /开发助手|招聘审计员|仍需补充|可执行的下一步/);
});

test('approved identity card is built only from public profile and project summaries', () => {
  const card = buildApprovedIdentityCard();

  assert.match(card, /Agent 系统开发者 × AI Native 实践者/);
  assert.match(card, /我把研究、内容生产、运营协作和个人知识入口/);
  assert.match(card, /内容创作 Agent 系统/);
  assert.match(card, /数字摩斯/);
  assert.doesNotMatch(
    card,
    /morse_resume_access|resume_documents|private[\\/]resume|trustedPersonNote/i,
  );
});

test('persona layer changes with the current turn intent without changing identity', () => {
  const technical = buildPersonaInstructions('technical');
  const recruitment = buildPersonaInstructions('recruitment');

  assert.match(technical, /第一性原理/);
  assert.match(technical, /已实现与规划/);
  assert.match(recruitment, /证据型候选人陈述/);
  assert.match(recruitment, /岗位相关项目/);
  assert.match(technical, /我是数字 Morse/);
  assert.match(recruitment, /我是数字 Morse/);
});
