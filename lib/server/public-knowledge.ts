export interface PublicKnowledgeDocument {
  id: string;
  title: string;
  sourcePath: string;
  href: string;
  content: string;
}

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
    capabilities?: string[];
    techStack?: Array<{ label?: string; items?: string[] }>;
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

export function publicKnowledgeHref(documentId: string): string {
  if (documentId === 'about' || documentId.startsWith('faq-')) return '/';
  if (documentId.startsWith('project-')) {
    return `/works#${documentId.slice('project-'.length)}`;
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
        ? `工作原则:\n${content.profile.principles.join('\n')}`
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
        project.caseStudy?.problem,
        project.caseStudy?.role,
        ...(project.caseStudy?.decisions ?? []),
        ...(project.caseStudy?.structure ?? []),
        ...(project.caseStudy?.evidence ?? []),
        ...(project.caseStudy?.boundaries ?? []),
      ]),
    });
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
