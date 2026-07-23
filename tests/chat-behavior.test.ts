import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  routeChatTurn,
  selectChatBehavior,
  stableChatCanaryBucket,
} from '../lib/server/chat-behavior.ts';
import { normalizeChatRequest } from '../lib/server/chat-core.ts';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const INVITE_ID = '22222222-2222-4222-8222-222222222222';

function request(message: string, audienceIntent: 'general' | 'recruiter' = 'general') {
  return normalizeChatRequest({ message, audienceIntent });
}

function jdRequest(jobDescription: string) {
  return normalizeChatRequest({
    workflow: 'jd_match',
    jobDescription,
    audienceIntent: 'recruiter',
  });
}

test('routeChatTurn gives the current message priority over the starter hint', () => {
  assert.deepEqual(routeChatTurn(request('你好', 'recruiter')), {
    intent: 'social',
    profile: 'social',
    evidence: 'none',
    release: 'segment',
    reasoningEffort: 'low',
  });
  assert.equal(routeChatTurn(request('这个岗位如何证明 Agent 经验？')).intent, 'recruitment');
  assert.deepEqual(routeChatTurn(jdRequest('Agent 工程师')), {
    intent: 'jd',
    profile: 'jd',
    evidence: 'rag',
    release: 'complete',
    reasoningEffort: 'low',
  });
});

test('routeChatTurn keeps lightweight introductions social without hiding a real request', () => {
  assert.equal(routeChatTurn(request('你好，很高兴认识你。')).intent, 'social');
  assert.equal(routeChatTurn(request('你好，我们先简单认识一下。')).evidence, 'none');
  assert.equal(routeChatTurn(request('你好，请介绍你的项目。')).intent, 'project');
});

test('routeChatTurn detects a structured full JD submitted through normal chat', () => {
  const fullJd = [
    'Agent 工程师',
    '岗位职责：',
    '1. 负责 Agent 工作流和 RAG 系统的设计与交付。',
    '2. 建设 Provider 可靠性和可观测能力。',
    '任职要求：',
    '1. 熟悉 TypeScript、PostgreSQL 和生产部署。',
    '2. 有复杂 AI 应用落地经验。',
  ].join('\n');

  assert.deepEqual(routeChatTurn(request(fullJd)), {
    intent: 'jd',
    profile: 'jd',
    evidence: 'rag',
    release: 'complete',
    reasoningEffort: 'low',
  });
});

test('selectChatBehavior follows safe, master, invite, and percentage priority', () => {
  assert.equal(selectChatBehavior({
    safeMode: true,
    v2Enabled: true,
    canaryPercent: 100,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set(),
  }), 'safe');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: true,
    canaryPercent: 0,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set([INVITE_ID]),
  }), 'v2');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: false,
    canaryPercent: 100,
    accessSessionId: SESSION_ID,
    inviteCodeId: INVITE_ID,
    canaryInviteIds: new Set([INVITE_ID]),
  }), 'v1');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: true,
    canaryPercent: 25,
    accessSessionId: SESSION_ID,
    inviteCodeId: null,
    canaryInviteIds: new Set(),
  }), 'v1');
  assert.equal(selectChatBehavior({
    safeMode: false,
    v2Enabled: true,
    canaryPercent: 26,
    accessSessionId: SESSION_ID,
    inviteCodeId: null,
    canaryInviteIds: new Set(),
  }), 'v2');
});

test('stableChatCanaryBucket uses the canonical session UUID deterministically', () => {
  assert.equal(stableChatCanaryBucket(SESSION_ID), 25);
  assert.equal(stableChatCanaryBucket(SESSION_ID.toUpperCase()), 25);
  assert.throws(() => stableChatCanaryBucket('not-a-uuid'), /UUID/);
});
