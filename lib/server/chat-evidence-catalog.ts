import type {
  ChatEvidenceCatalogV2,
  CompiledCapabilityEntry,
  CompiledChatEvidenceCatalog,
  CompiledEvidenceReference,
  CompiledProjectEntry,
} from '../contracts/chat-evidence-catalog.ts';
import type { KnowledgeSource } from '../contracts/chat-runtime.ts';
import type { ProjectSlug, SiteContent } from '../contracts/site-content.ts';
import { chatEvidenceCatalog, siteContent } from '../site-content.ts';
import { approvedProjectSource } from './chat-project-evidence.ts';

function invalidCatalog(detail: string): never {
  throw new Error(`CHAT_EVIDENCE_CATALOG_INVALID: ${detail}`);
}

export function normalizeCatalogAlias(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function validateId(id: string, kind: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    invalidCatalog(`invalid ${kind} id ${id}`);
  }
}

function compileAliases<T extends string>(
  entries: readonly { id: T; aliases: readonly string[] }[],
  kind: string,
): Array<{ id: T; normalized: string }> {
  const owners = new Map<string, T>();
  const aliases: Array<{ id: T; normalized: string }> = [];
  for (const entry of entries) {
    if (entry.aliases.length === 0) invalidCatalog(`missing aliases for ${kind} ${entry.id}`);
    for (const value of entry.aliases) {
      const normalized = normalizeCatalogAlias(value);
      if (!normalized) invalidCatalog(`empty alias for ${kind} ${entry.id}`);
      const owner = owners.get(normalized);
      if (owner && owner !== entry.id) {
        invalidCatalog(`alias ${value} belongs to both ${owner} and ${entry.id}`);
      }
      if (!owner) {
        owners.set(normalized, entry.id);
        aliases.push({ id: entry.id, normalized });
      }
    }
  }
  return aliases.sort((left, right) => right.normalized.length - left.normalized.length);
}

function compileEvidenceReference(
  content: SiteContent,
  capabilityId: string,
  reference: ChatEvidenceCatalogV2['capabilities'][number]['evidenceRefs'][number],
): CompiledEvidenceReference {
  if (reference.kind === 'project') {
    const project = content.projects.find((candidate) => candidate.slug === reference.projectSlug);
    if (!project) {
      invalidCatalog(`capability ${capabilityId} references unknown project ${reference.projectSlug}`);
    }
    return {
      kind: 'project',
      projectSlug: project.slug,
      projectName: project.name,
      disclosure: project.disclosure,
      project,
      resumeFactId: null,
      level: reference.level,
    };
  }

  const resumeFact = (content.profile.resumeFacts ?? []).find(
    (candidate) => candidate.id === reference.resumeFactId,
  );
  if (!resumeFact) {
    invalidCatalog(`capability ${capabilityId} references unknown resume fact ${reference.resumeFactId}`);
  }
  if (!resumeFact.capabilityIds.includes(capabilityId)) {
    invalidCatalog(
      `resume fact ${reference.resumeFactId} does not declare capability ${capabilityId}`,
    );
  }
  return {
    kind: 'resume_fact',
    projectSlug: null,
    projectName: resumeFact.title,
    disclosure: 'internal-redacted',
    resumeFactId: resumeFact.id,
    resumeFact,
    level: reference.level,
  };
}

export function compileChatEvidenceCatalog(
  content: SiteContent,
  input: ChatEvidenceCatalogV2,
): CompiledChatEvidenceCatalog {
  if (input.version !== 2) invalidCatalog('unsupported version');

  const contentProjects = new Map(content.projects.map((project) => [project.slug, project]));
  if (contentProjects.size !== content.projects.length) invalidCatalog('duplicate project slug in content');
  const projectIds = new Set<ProjectSlug>();
  const projects: CompiledProjectEntry[] = [];
  for (const candidate of input.projects) {
    validateId(candidate.slug, 'project');
    if (projectIds.has(candidate.slug)) invalidCatalog(`duplicate project ${candidate.slug}`);
    const project = contentProjects.get(candidate.slug);
    if (!project) invalidCatalog(`unknown project ${candidate.slug}`);
    projectIds.add(candidate.slug);
    projects.push({ slug: candidate.slug, aliases: [...candidate.aliases], project });
  }
  for (const project of content.projects) {
    if (!projectIds.has(project.slug)) invalidCatalog(`missing project ${project.slug}`);
  }
  if (projects.length !== content.projects.length) invalidCatalog('project coverage mismatch');

  const projectAliasRows = compileAliases(
    input.projects.map((project) => ({ id: project.slug, aliases: project.aliases })),
    'project',
  );

  const capabilityIds = new Set<string>();
  for (const candidate of input.capabilities) {
    validateId(candidate.id, 'capability');
    if (capabilityIds.has(candidate.id)) invalidCatalog(`duplicate capability ${candidate.id}`);
    if (!candidate.label.trim()) invalidCatalog(`missing label for capability ${candidate.id}`);
    capabilityIds.add(candidate.id);
  }
  const capabilityAliasRows = compileAliases(
    input.capabilities.map((entry) => ({ id: entry.id, aliases: entry.aliases })),
    'capability',
  );

  const resumeFactIds = new Set<string>();
  for (const fact of content.profile.resumeFacts ?? []) {
    if (!fact.id.trim() || !fact.title.trim() || !fact.content.trim()) {
      invalidCatalog(`invalid resume fact ${fact.id}`);
    }
    if (resumeFactIds.has(fact.id)) invalidCatalog(`duplicate resume fact ${fact.id}`);
    resumeFactIds.add(fact.id);
    for (const capabilityId of fact.capabilityIds) {
      if (!capabilityIds.has(capabilityId)) {
        invalidCatalog(`resume fact ${fact.id} references unknown capability ${capabilityId}`);
      }
    }
  }

  const capabilities = new Map<string, CompiledCapabilityEntry>();
  for (const candidate of input.capabilities) {
    const seenReferences = new Set<string>();
    const references = candidate.evidenceRefs.map((reference) => {
      const referenceId = reference.kind === 'project'
        ? `project:${reference.projectSlug}`
        : `resume_fact:${reference.resumeFactId}`;
      if (seenReferences.has(referenceId)) {
        invalidCatalog(`duplicate evidence reference ${referenceId} for ${candidate.id}`);
      }
      seenReferences.add(referenceId);
      return compileEvidenceReference(content, candidate.id, reference);
    });
    const direct = references.filter((reference) => reference.level === 'direct');
    const transferable = references.filter((reference) => reference.level === 'transferable');
    const evidenceClass = direct.length > 0
      ? 'direct' as const
      : transferable.length > 0
        ? 'transferable' as const
        : 'unavailable' as const;
    if (evidenceClass !== 'direct' && !candidate.unavailableBoundary?.trim()) {
      invalidCatalog(`missing boundary for ${evidenceClass} capability ${candidate.id}`);
    }
    capabilities.set(candidate.id, {
      id: candidate.id,
      label: candidate.label,
      aliases: [...candidate.aliases],
      evidenceClass,
      direct,
      transferable,
      unavailableBoundary: candidate.unavailableBoundary?.trim() || null,
    });
  }

  for (const fact of content.profile.resumeFacts ?? []) {
    for (const capabilityId of fact.capabilityIds) {
      const capability = capabilities.get(capabilityId);
      if (!capability?.direct.some((reference) => (
        reference.kind === 'resume_fact' && reference.resumeFactId === fact.id
      ))) {
        invalidCatalog(`missing direct reference from ${capabilityId} to resume fact ${fact.id}`);
      }
    }
  }

  return {
    version: 2,
    projects,
    resumeFacts: [...(content.profile.resumeFacts ?? [])],
    capabilities,
    unresolvedReferences: [],
    projectAliases: projectAliasRows.map(({ id, normalized }) => ({ slug: id, normalized })),
    capabilityAliases: capabilityAliasRows.map(({ id, normalized }) => ({
      capabilityId: id,
      normalized,
    })),
  };
}

function containsCapabilityAlias(value: string, normalizedAlias: string): boolean {
  if (/^[a-z0-9]{2,8}$/u.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(
      value.normalize('NFKC').toLocaleLowerCase('en-US'),
    );
  }
  return normalizeCatalogAlias(value).includes(normalizedAlias);
}

export function matchCatalogProjects(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): ProjectSlug[] {
  const normalized = normalizeCatalogAlias(value);
  return catalog.projects
    .filter((project) => catalog.projectAliases.some((alias) => (
      alias.slug === project.slug && normalized.includes(alias.normalized)
    )))
    .map((project) => project.slug);
}

export interface CatalogProjectScope {
  projectRefs: ProjectSlug[];
}

function selectedProjectFromCorrection(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): ProjectSlug[] | null {
  const normalized = value.normalize('NFKC');
  const correctionPatterns = [
    /(?:我说的是|我指的是)\s*([^，,。；;：:\n]+?)(?:\s*[，,]\s*|\s*而\s*)不是\s*([^，,。；;：:\n]+)/iu,
    /不是\s*([^，,。；;：:\n]+?)(?:\s*[，,]\s*|\s*而\s*)(?:是|改成|换成)\s*([^，,。；;：:\n]+)/iu,
  ];

  for (const pattern of correctionPatterns) {
    const match = pattern.exec(normalized);
    if (!match) continue;
    const affirmed = matchOrderedCatalogProjects(match[1], catalog);
    const dismissed = matchOrderedCatalogProjects(match[2], catalog);
    if (affirmed.length === 1 && dismissed.length === 1 && affirmed[0] !== dismissed[0]) {
      return affirmed;
    }
  }

  return null;
}

export function matchOrderedCatalogProjects(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): ProjectSlug[] {
  const normalized = normalizeCatalogAlias(value);
  return catalog.projects
    .flatMap((project, projectIndex) => {
      const firstIndex = project.aliases.reduce((earliest, alias) => {
        const index = normalized.indexOf(normalizeCatalogAlias(alias));
        return index >= 0 && index < earliest ? index : earliest;
      }, Number.MAX_SAFE_INTEGER);
      return firstIndex === Number.MAX_SAFE_INTEGER
        ? []
        : [{ slug: project.slug, firstIndex, projectIndex }];
    })
    .sort((left, right) => left.firstIndex - right.firstIndex || left.projectIndex - right.projectIndex)
    .map((project) => project.slug);
}

function selectedProjectAfterDismissal(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
  projectRefs: readonly ProjectSlug[],
): ProjectSlug[] | null {
  const dismissal = /(?:^|[，,。；;：:\n]\s*)(?:先|暂时)?\s*不(?:聊|谈|讲|说)\s*([^，,。；;：:\n]+?)(?:了)?(?:[，,]|$)/iu.exec(
    value.normalize('NFKC'),
  );
  if (!dismissal) return null;
  const dismissed = matchOrderedCatalogProjects(dismissal[1], catalog);
  const remaining = projectRefs.filter((projectRef) => !dismissed.includes(projectRef));
  return dismissed.length > 0 && remaining.length === 1 ? remaining : null;
}

export function resolveCatalogProjectScope(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): CatalogProjectScope {
  const projectRefs = matchOrderedCatalogProjects(value, catalog);
  const correction = selectedProjectFromCorrection(value, catalog);
  const dismissal = correction
    ? null
    : selectedProjectAfterDismissal(value, catalog, projectRefs);
  return { projectRefs: correction ?? dismissal ?? projectRefs };
}

export function mentionsCatalogProject(
  value: string,
  slug: ProjectSlug,
  catalog: CompiledChatEvidenceCatalog,
): boolean {
  return matchCatalogProjects(value, catalog).includes(slug);
}

export function matchCatalogCapabilities(
  value: string,
  catalog: CompiledChatEvidenceCatalog,
): CompiledCapabilityEntry[] {
  const normalizedValue = normalizeCatalogAlias(value);
  const matches = catalog.capabilityAliases
    .filter((alias) => containsCapabilityAlias(value, alias.normalized))
    .map((alias) => ({
      ...alias,
      position: normalizedValue.indexOf(alias.normalized),
    }))
    .sort((left, right) => (
      left.position - right.position || right.normalized.length - left.normalized.length
    ));
  const ids: string[] = [];
  for (const match of matches) {
    if (!ids.includes(match.capabilityId)) ids.push(match.capabilityId);
  }
  return ids.map((id) => {
    const entry = catalog.capabilities.get(id);
    if (!entry) invalidCatalog(`missing compiled capability ${id}`);
    return entry;
  });
}

function resumeFactSource(
  fact: NonNullable<SiteContent['profile']['resumeFacts']>[number],
): KnowledgeSource {
  return {
    chunkId: `resume-fact:${fact.id}`,
    documentId: 'resume-facts',
    title: fact.title,
    sourcePath: 'content/site-content.json#profile.resumeFacts',
    href: '/',
    content: fact.content,
    score: 1,
    projectSlug: null,
    topicIds: ['resume', ...fact.capabilityIds],
    evidenceLevel: 'direct',
  };
}

export function allApprovedPortfolioEvidence(
  catalog: CompiledChatEvidenceCatalog,
): KnowledgeSource[] {
  const projects = catalog.projects.map((entry) => approvedProjectSource(entry.project));
  return [...projects, ...catalog.resumeFacts.map(resumeFactSource)];
}

export const compiledChatEvidenceCatalog = compileChatEvidenceCatalog(
  siteContent,
  chatEvidenceCatalog,
);
