import { siteContent } from '../site-content.ts';
import type { TurnIntent } from './chat-behavior.ts';
import type { KnowledgeSource } from './rag.ts';

export interface SafeChatAnswerInput {
  intent: TurnIntent;
  sources: KnowledgeSource[];
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
  if (input.intent === 'social' || input.intent === 'identity') {
    return {
      text: approvedIdentitySummary(),
      sources: [identityKnowledgeSource()],
    };
  }
  if (input.intent === 'jd') return null;
  if (input.sources.length === 0) return null;

  const sources = input.sources.slice(0, 2);
  return {
    text: sources.map((source, index) => (
      `${index + 1}. ${source.title}：${safeSummary(source.content)} [来源${index + 1}]`
    )).join('\n'),
    sources,
  };
}
