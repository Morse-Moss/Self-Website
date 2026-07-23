import type { ChatRouteDecision } from './chat-route-policy.ts';
import { chatProjectReferences } from './chat-projects.ts';
import {
  assessCapability,
  assessCapabilities,
  type CapabilityAssessment,
  type CapabilityEvidenceRef,
  type CapabilityLedger,
} from './capability-evidence.ts';
import {
  admitKnowledgeForRoute,
  type KnowledgeSource,
} from './rag.ts';
import type { SearchResponse } from './search-provider.ts';

export interface ResolvedChatEvidence {
  capability: CapabilityAssessment | null;
  knowledge: KnowledgeSource[];
  search: SearchResponse | undefined;
}

export interface ResolveChatEvidenceInput {
  route: ChatRouteDecision;
  question: string;
  ledger: CapabilityLedger;
  embed(query: string): Promise<number[]>;
  retrieve(embedding: number[]): Promise<KnowledgeSource[]>;
  search(): Promise<SearchResponse | undefined>;
  identityKnowledge?: () => KnowledgeSource[];
}

function emptyEvidence(): ResolvedChatEvidence {
  return { knowledge: [], search: undefined, capability: null };
}

function ledgerSource(reference: CapabilityEvidenceRef): KnowledgeSource {
  const documentId = `project-${reference.projectSlug}`;
  return {
    chunkId: `${documentId}:ledger:${reference.capabilityId}`,
    documentId,
    title: reference.projectName,
    sourcePath: `content/site-content.json#projects.${reference.projectSlug}`,
    href: `/works#${reference.projectSlug}`,
    content: `${reference.label}：${reference.sourceText}`,
    score: 1,
    projectSlug: reference.projectSlug,
    topicIds: [reference.capabilityId],
  };
}

function capabilityKnowledge(capability: CapabilityAssessment): KnowledgeSource[] {
  const unique = new Map<string, KnowledgeSource>();
  for (const reference of [...capability.direct, ...capability.transferable]) {
    const source = ledgerSource(reference);
    unique.set(`${source.documentId}:${reference.capabilityId}`, source);
  }
  return [...unique.values()];
}

function jdCapabilityKnowledge(question: string, ledger: CapabilityLedger): KnowledgeSource[] {
  const grouped = new Map<string, {
    source: KnowledgeSource;
    content: Set<string>;
    topicIds: Set<string>;
  }>();
  for (const assessment of assessCapabilities(question, ledger)) {
    const references = [...assessment.direct, ...assessment.transferable];
    for (const reference of references) {
      const source = ledgerSource(reference);
      const group = grouped.get(reference.projectSlug) ?? {
        source: { ...source, chunkId: `${source.documentId}:ledger:jd` },
        content: new Set<string>(),
        topicIds: new Set<string>(),
      };
      group.content.add(source.content);
      group.topicIds.add(reference.capabilityId);
      if (assessment.capabilityId) group.topicIds.add(assessment.capabilityId);
      grouped.set(reference.projectSlug, group);
    }
    if (assessment.boundaryText && references[0] && assessment.label) {
      grouped.get(references[0].projectSlug)?.content.add(
        `${assessment.label}：${assessment.boundaryText}`,
      );
    }
  }
  return [...grouped.values()].map((group) => ({
    ...group.source,
    content: [...group.content].join('；'),
    topicIds: [...group.topicIds],
  }));
}

function mergeJdKnowledge(
  semantic: KnowledgeSource[],
  capability: KnowledgeSource[],
): KnowledgeSource[] {
  const result = semantic.map((source) => ({ ...source }));
  for (const capabilitySource of capability) {
    const index = result.findIndex((source) => (
      source.projectSlug === capabilitySource.projectSlug
    ));
    if (index < 0) {
      result.push(capabilitySource);
      continue;
    }
    const existing = result[index];
    result[index] = {
      ...existing,
      content: `${existing.content}\n能力台账：${capabilitySource.content}`,
      topicIds: [...new Set([
        ...(existing.topicIds ?? []),
        ...(capabilitySource.topicIds ?? []),
      ])],
      score: Math.max(existing.score, capabilitySource.score),
    };
  }
  return result;
}

function retrievalQuery(route: ChatRouteDecision, question: string): string {
  if (
    route.reasonCode !== 'anaphoric_project_followup'
    || route.topicKind !== 'project'
    || !route.topicRef
  ) {
    return question;
  }
  const project = chatProjectReferences.find((candidate) => candidate.slug === route.topicRef);
  const projectName = project?.aliases[0];
  return projectName ? `${projectName}：${question}` : question;
}

export async function resolveChatEvidence(
  input: ResolveChatEvidenceInput,
): Promise<ResolvedChatEvidence> {
  switch (input.route.routeKind) {
    case 'conversation':
    case 'clarify':
    case 'jd_intake':
      return emptyEvidence();
    case 'identity':
      return {
        capability: null,
        knowledge: input.identityKnowledge?.() ?? [],
        search: undefined,
      };
    case 'external_current':
      return {
        capability: null,
        knowledge: [],
        search: await input.search(),
      };
    case 'personal_fact': {
      const capability = assessCapability(input.question, input.ledger);
      return {
        capability,
        knowledge: capabilityKnowledge(capability),
        search: undefined,
      };
    }
    case 'grounded': {
      const embedding = await input.embed(retrievalQuery(input.route, input.question));
      const candidates = await input.retrieve(embedding);
      return {
        capability: null,
        knowledge: admitKnowledgeForRoute(input.route, candidates, input.question),
        search: undefined,
      };
    }
    case 'jd': {
      const embedding = await input.embed(input.question);
      const candidates = await input.retrieve(embedding);
      const semantic = admitKnowledgeForRoute(input.route, candidates, input.question);
      return {
        capability: null,
        knowledge: mergeJdKnowledge(
          semantic,
          jdCapabilityKnowledge(input.question, input.ledger),
        ),
        search: undefined,
      };
    }
  }
}
