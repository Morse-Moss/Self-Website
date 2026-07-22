import type { ChatRouteDecision } from './chat-route-policy.ts';
import {
  assessCapability,
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
    case 'grounded':
    case 'jd': {
      const embedding = await input.embed(input.question);
      const candidates = await input.retrieve(embedding);
      return {
        capability: null,
        knowledge: admitKnowledgeForRoute(input.route, candidates),
        search: undefined,
      };
    }
  }
}
