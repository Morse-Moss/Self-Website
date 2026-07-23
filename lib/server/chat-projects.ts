import { siteContent, type ProjectSlug } from '../site-content.ts';

const MANUAL_ALIASES: Record<ProjectSlug, readonly string[]> = {
  'content-agent': ['内容创作', '内容创作agent', '内容生成agent', '内容agent', 'contentagent'],
  'auto-operations': ['自动运营agent', '自动运营', 'autooperations'],
  'ai-leadgen': ['ai外贸获客', '外贸获客系统', '外贸获客', 'aileadgen'],
  'deep-research': ['深度研究agent', '深度研究', 'deepresearch'],
  'digital-morse': ['数字morse', '数字摩斯', 'digitalmorse'],
};

export interface ChatProjectReference {
  slug: ProjectSlug;
  aliases: readonly string[];
}

export const chatProjectReferences: readonly ChatProjectReference[] =
  siteContent.projects.map((project) => ({
    slug: project.slug,
    aliases: [...new Set([
      project.name,
      project.slug,
      ...MANUAL_ALIASES[project.slug],
    ])],
  }));

export function normalizeChatProjectReference(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

export function matchChatProjectSlugs(value: string): ProjectSlug[] {
  const normalized = normalizeChatProjectReference(value);
  return chatProjectReferences
    .filter((project) => project.aliases.some((alias) => (
      normalized.includes(normalizeChatProjectReference(alias))
    )))
    .map((project) => project.slug);
}

export function mentionsChatProject(value: string, slug: ProjectSlug): boolean {
  const project = chatProjectReferences.find((candidate) => candidate.slug === slug);
  if (!project) return false;
  const normalized = normalizeChatProjectReference(value);
  return project.aliases.some((alias) => (
    normalized.includes(normalizeChatProjectReference(alias))
  ));
}
