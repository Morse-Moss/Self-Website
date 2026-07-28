import type { KnowledgeSource } from '../contracts/chat-runtime.ts';
import type { Project } from '../contracts/site-content.ts';
import { siteContent } from '../site-content.ts';

function renderList(values: readonly string[]): string {
  return values.length > 0 ? values.join('；') : '审核公开资料未提供';
}

export function approvedProjectSource(
  project: Project,
  level: 'direct' | 'transferable' = 'direct',
  options: { score?: number; retrievedContent?: string; topicIds?: string[] } = {},
): KnowledgeSource {
  const details = [
    `项目概述：${project.summary}`,
    `原始业务问题：${project.caseStudy.problem}`,
    `本人职责：${project.caseStudy.role}`,
    `关键决策：${renderList(project.caseStudy.decisions)}`,
    `系统结构：${renderList(project.caseStudy.structure)}`,
    `验证结果：${renderList(project.caseStudy.evidence)}`,
    `事实边界：${renderList(project.caseStudy.boundaries)}`,
    `审核能力：${project.capabilities.join('、')}`,
    options.retrievedContent ? `相关审核片段：${options.retrievedContent}` : '',
  ].filter(Boolean);
  return {
    chunkId: `project:${project.slug}`,
    documentId: `project-${project.slug}`,
    title: project.name,
    sourcePath: `content/site-content.json#projects.${project.slug}`,
    href: `/works#${project.slug}`,
    content: details.join('\n'),
    score: options.score ?? 1,
    projectSlug: project.slug,
    topicIds: [...new Set([project.slug, ...(options.topicIds ?? [])])],
    evidenceLevel: level,
  };
}

export function approvedProjectCatalogSources(): KnowledgeSource[] {
  return siteContent.projects.map((project) => approvedProjectSource(project));
}
