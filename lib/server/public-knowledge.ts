export interface PublicKnowledgeDocument {
  id: string;
  title: string;
  sourcePath: string;
  content: string;
}

interface PublicContent {
  about?: {
    title?: string;
    intro?: string;
    points?: Array<{ title?: string; body?: string }>;
  };
  gallery?: {
    cards?: Array<{
      id?: string;
      title?: string;
      state?: string;
      problem?: string;
      solution?: string;
      humanAiSplit?: string;
      sampleLabel?: string;
    }>;
  };
  faq?: {
    items?: Array<{ question?: string; answer?: string }>;
  };
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part?.trim())).join('\n\n');
}

export function extractPublicKnowledge(content: PublicContent): PublicKnowledgeDocument[] {
  const documents: PublicKnowledgeDocument[] = [];

  if (content.about?.title && content.about.intro) {
    documents.push({
      id: 'about',
      title: content.about.title,
      sourcePath: 'content/s3-content.json#about',
      content: joinParts([
        content.about.intro,
        ...(content.about.points ?? []).flatMap((point) => [point.title, point.body]),
      ]),
    });
  }

  for (const card of content.gallery?.cards ?? []) {
    if (!card.id || !card.title || card.sampleLabel === '示例数据') continue;

    documents.push({
      id: `project-${card.id}`,
      title: card.title,
      sourcePath: `content/s3-content.json#gallery.${card.id}`,
      content: joinParts([
        card.state,
        `问题:${card.problem ?? ''}`,
        `方案:${card.solution ?? ''}`,
        `人机分工:${card.humanAiSplit ?? ''}`,
      ]),
    });
  }

  for (const [index, item] of (content.faq?.items ?? []).entries()) {
    if (!item.question || !item.answer) continue;

    documents.push({
      id: `faq-${index + 1}`,
      title: item.question,
      sourcePath: `content/s3-content.json#faq.${index + 1}`,
      content: joinParts([item.question, item.answer]),
    });
  }

  return documents;
}
