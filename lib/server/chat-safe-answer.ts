import { siteContent } from '../site-content.ts';
import type { TurnIntent } from './chat-behavior.ts';
import type { KnowledgeSource } from './rag.ts';

export interface SafeChatAnswerInput {
  intent: TurnIntent;
  sources: KnowledgeSource[];
  operatorSafeMode?: boolean;
}

export interface SafeChatAnswer {
  text: string;
  sources: KnowledgeSource[];
}

function identityKnowledgeSource(): KnowledgeSource {
  return {
    chunkId: 'about:safe',
    documentId: 'about',
    title: siteContent.profile.title,
    sourcePath: 'content/site-content.json#profile',
    href: '/',
    content: `${siteContent.profile.role}\n${siteContent.profile.summary}`,
    score: 1,
  };
}

function approvedIdentitySummary(): string {
  return [
    '我是数字 Morse，是真人 Morse 为作品集创建的数字分身。',
    `${siteContent.profile.role}。${siteContent.profile.summary}`,
    '[来源1]',
  ].join('\n');
}

function safeSummary(content: string): string {
  const normalized = content
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\[来源\d+\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157).trimEnd()}...`;
}

export function buildSafeChatAnswer(input: SafeChatAnswerInput): SafeChatAnswer | null {
  if (!input.operatorSafeMode) return null;
  if (input.intent === 'social' || input.intent === 'identity') {
    return {
      text: approvedIdentitySummary(),
      sources: [identityKnowledgeSource()],
    };
  }
  if (input.sources.length === 0) return null;

  const sources = input.sources.slice(0, 2);
  if (input.intent === 'jd') {
    return {
      text: [
        '\u5f53\u524d\u5904\u4e8e\u5b89\u5168\u6a21\u5f0f\uff0c\u65e0\u6cd5\u53ef\u9760\u751f\u6210\u4e2a\u6027\u5316\u5c97\u4f4d\u5339\u914d\u7ed3\u8bba\u3002\u4ee5\u4e0b\u4ec5\u5217\u51fa\u53ef\u6838\u9a8c\u7684\u516c\u5f00\u9879\u76ee\u8d44\u6599\uff1a',
        ...sources.map((source, index) => (
          `${index + 1}. ${source.title}\uff1a${safeSummary(source.content)} [\u6765\u6e90${index + 1}]`
        )),
      ].join('\n'),
      sources,
    };
  }
  return {
    text: sources.map((source, index) => (
      `${index + 1}. ${source.title}：${safeSummary(source.content)} [来源${index + 1}]`
    )).join('\n'),
    sources,
  };
}
