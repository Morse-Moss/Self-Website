export interface PublicKnowledgeDocument {
  id: string;
  title: string;
  sourcePath: string;
  href: string;
  content: string;
}

const publicProjectSlugs = [
  'content-agent',
  'auto-operations',
  'deep-research',
  'digital-morse',
] as const;

interface SiteContent {
  profile?: {
    title?: string;
    role?: string;
    summary?: string;
    principles?: string[];
  };
  projects?: Array<{
    slug?: string;
    name?: string;
    status?: string;
    summary?: string;
    knowledgeTopics?: Array<{
      id?: string;
      title?: string;
      content?: string;
    }>;
    capabilities?: string[];
    techStack?: Array<{ label?: string; items?: string[] }>;
    details?: {
      overview?: string[];
      coreCapabilities?: string[];
      architecture?: {
        flow?: string;
        modules?: string[];
      };
      implementation?: {
        summary?: string;
        contributions?: string[];
        futureDirection?: string;
      };
    };
    caseStudy?: {
      problem?: string;
      role?: string;
      decisions?: string[];
      structure?: string[];
      evidence?: string[];
      boundaries?: string[];
    };
  }>;
  faq?: Array<{ question?: string; answer?: string }>;
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n\n');
}

function projectDetailParts(
  project: NonNullable<SiteContent['projects']>[number],
): Array<string | undefined> {
  if (project.details) {
    return [
      ...(project.details.overview ?? []),
      project.details.coreCapabilities?.length
        ? `核心能力:\n${project.details.coreCapabilities.join('\n')}`
        : undefined,
      project.details.architecture?.flow,
      project.details.architecture?.modules?.length
        ? `系统模块:\n${project.details.architecture.modules.join('\n')}`
        : undefined,
      project.details.implementation?.summary,
      ...(project.details.implementation?.contributions ?? []),
      project.details.implementation?.futureDirection,
    ];
  }

  return [
    project.caseStudy?.problem,
    project.caseStudy?.role,
    ...(project.caseStudy?.decisions ?? []),
    ...(project.caseStudy?.structure ?? []),
  ];
}

export function publicKnowledgeHref(documentId: string): string {
  if (documentId === 'about' || documentId.startsWith('faq-')) return '/';
  if (documentId.startsWith('project-')) {
    const projectId = documentId.slice('project-'.length);
    const slug = publicProjectSlugs.find(
      (candidate) => projectId === candidate || projectId.startsWith(`${candidate}-`),
    );
    return `/works#${slug ?? projectId}`;
  }
  return '/';
}

export function extractPublicKnowledge(content: SiteContent): PublicKnowledgeDocument[] {
  const documents: PublicKnowledgeDocument[] = [];

  if (content.profile?.title) {
    const profileContent = joinParts([
      content.profile.title,
      content.profile.role,
      content.profile.summary,
      content.profile.principles?.length
        ? `Morse 的工作原则、事实边界与安全边界:\n${content.profile.principles.join('\n')}`
        : undefined,
    ]);

    if (profileContent) {
      documents.push({
        id: 'about',
        title: content.profile.title,
        sourcePath: 'content/site-content.json#profile',
        href: publicKnowledgeHref('about'),
        content: profileContent,
      });
    }
  }

  for (const project of content.projects ?? []) {
    if (!project.slug || !project.name) continue;

    documents.push({
      id: `project-${project.slug}`,
      title: project.name,
      sourcePath: `content/site-content.json#projects.${project.slug}`,
      href: publicKnowledgeHref(`project-${project.slug}`),
      content: joinParts([
        project.name,
        project.status,
        project.summary,
        project.capabilities?.length
          ? `能力:\n${project.capabilities.join('\n')}`
          : undefined,
        ...(project.techStack ?? []).map((group) =>
          group.label && group.items?.length
            ? `${group.label}:\n${group.items.join('\n')}`
            : undefined,
        ),
        ...projectDetailParts(project),
      ]),
    });

    for (const topic of project.knowledgeTopics ?? []) {
      if (!topic.id || !topic.title || !topic.content) continue;

      const id = `project-${project.slug}-${topic.id}`;
      documents.push({
        id,
        title: `${project.name}：${topic.title}`,
        sourcePath: `content/site-content.json#projects.${project.slug}.knowledge.${topic.id}`,
        href: publicKnowledgeHref(id),
        content: joinParts([project.name, topic.title, topic.content]),
      });
    }
  }

  for (const [index, item] of (content.faq ?? []).entries()) {
    if (!item.question || !item.answer) continue;

    documents.push({
      id: `faq-${index + 1}`,
      title: item.question,
      sourcePath: `content/site-content.json#faq.${index + 1}`,
      href: publicKnowledgeHref(`faq-${index + 1}`),
      content: joinParts([item.question, item.answer]),
    });
  }

  return documents;
}
