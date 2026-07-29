import type {
  CandidateConversationTaskFrameV22,
  ConversationTaskFrameV22,
  ResolvedChatTurn,
} from '../contracts/chat-context.ts';
import type {
  CompiledChatEvidenceCatalog,
  CompiledEvidenceReference,
  EvidenceBundle,
} from '../contracts/chat-evidence-catalog.ts';
import type { KnowledgeSource } from '../contracts/chat-runtime.ts';
import type {
  ConversationSessionSnapshot,
  TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import type { Project, ProjectSlug } from '../contracts/site-content.ts';
import { siteContent } from '../site-content.ts';
import {
  allApprovedPortfolioEvidence,
  matchCatalogCapabilities,
} from './chat-evidence-catalog.ts';
import { approvedProjectSource } from './chat-project-evidence.ts';
import {
  assessCapabilities,
  assessCapability,
  type CapabilityAssessment,
  type CapabilityEvidenceRef,
  type CapabilityLedger,
} from './capability-evidence.ts';
import { LOCAL_EVIDENCE_MIN_SCORE } from './rag.ts';
import { partitionCompleteRetrievalQuery } from './retrieval-query.ts';

export type EvidenceAdmissionLevel = 'direct' | 'transferable' | 'unavailable';

export interface EvidenceAdmission {
  evidenceId: string | null;
  level: EvidenceAdmissionLevel;
  projectSlug: string | null;
  capabilityId: string | null;
}

export interface PlannedChatEvidence {
  knowledge: KnowledgeSource[];
  admissions: EvidenceAdmission[];
  retrievalScores: Array<{ evidenceId: string; score: number }>;
  degradedReason: 'embedding' | 'retrieval' | null;
}

export interface PlanChatEvidenceInput {
  resolved: ResolvedChatTurn;
  currentInput: string;
  frame: CandidateConversationTaskFrameV22 | ConversationTaskFrameV22 | null;
  ledger: CapabilityLedger;
  embed?(query: string): Promise<number[]>;
  retrieve?(embedding: number[], legacyLimit?: number): Promise<KnowledgeSource[]>;
  embedAll?(queries: readonly string[]): Promise<readonly number[][]>;
  retrieveAll?(embeddings: readonly number[][]): Promise<KnowledgeSource[]>;
}

export interface PlanEvidenceBundleInput {
  plan: TurnPlanV1;
  session: ConversationSessionSnapshot;
  catalog: CompiledChatEvidenceCatalog;
  retrieval: {
    embed?(query: string): Promise<number[]>;
    retrieve?(embedding: number[], legacyLimit?: number): Promise<KnowledgeSource[]>;
    embedAll?(queries: readonly string[]): Promise<readonly number[][]>;
    retrieveAll?(embeddings: readonly number[][]): Promise<KnowledgeSource[]>;
  };
}

const projectOrder = new Map(
  siteContent.projects.map((project, index) => [project.slug, index]),
);
const RECRUITMENT_RETRIEVAL_CHUNK_CHARACTERS = 256;

function auditedProject(slug: string): Project | null {
  return siteContent.projects.find((project) => project.slug === slug) ?? null;
}

function identitySource(): KnowledgeSource {
  return {
    chunkId: 'about:identity',
    documentId: 'about',
    title: 'Morse',
    sourcePath: 'content/site-content.json#profile',
    href: '/',
    content: siteContent.profile.summary,
    score: 1,
    topicIds: ['identity'],
    evidenceLevel: 'direct',
  };
}

function admission(source: KnowledgeSource): EvidenceAdmission {
  return {
    evidenceId: source.chunkId,
    level: source.evidenceLevel ?? 'direct',
    projectSlug: source.projectSlug ?? null,
    capabilityId: source.topicIds?.find((topic) => !projectOrder.has(topic as ProjectSlug)) ?? null,
  };
}

function admissions(
  knowledge: readonly KnowledgeSource[],
  assessments: readonly CapabilityAssessment[] = [],
): EvidenceAdmission[] {
  return [
    ...knowledge.map(admission),
    ...assessments
      .filter((assessment) => assessment.evidenceClass === 'none')
      .map((assessment) => ({
        evidenceId: null,
        level: 'unavailable' as const,
        projectSlug: null,
        capabilityId: assessment.capabilityId,
      })),
  ];
}

function capabilitySource(
  reference: CapabilityEvidenceRef,
  level: 'direct' | 'transferable',
): KnowledgeSource {
  if (reference.projectSlug) {
    const project = auditedProject(reference.projectSlug);
    if (project) {
      return approvedProjectSource(project, level, {
        topicIds: [reference.capabilityId],
        retrievedContent: `${reference.label}：${reference.sourceText}`,
      });
    }
  }
  return {
    chunkId: `resume-facts:ledger:${reference.capabilityId}`,
    documentId: 'resume-facts',
    title: reference.projectName,
    sourcePath: 'content/site-content.json#profile.resumeFacts',
    href: '/',
    content: `${reference.label}：${reference.sourceText}`,
    score: 1,
    projectSlug: null,
    topicIds: [reference.capabilityId, 'resume'],
    evidenceLevel: level,
  };
}

function capabilityEvidence(assessments: readonly CapabilityAssessment[]): PlannedChatEvidence {
  const byKey = new Map<string, KnowledgeSource>();
  for (const assessment of assessments) {
    for (const [level, references] of [
      ['direct', assessment.direct],
      ['transferable', assessment.transferable],
    ] as const) {
      for (const reference of references) {
        const source = capabilitySource(reference, level);
        const key = `${source.documentId}:${assessment.capabilityId ?? reference.capabilityId}`;
        const existing = byKey.get(key);
        if (!existing || (existing.evidenceLevel === 'transferable' && level === 'direct')) {
          byKey.set(key, source);
        }
      }
    }
  }
  const knowledge = [...byKey.values()];
  return {
    knowledge,
    admissions: admissions(knowledge, assessments),
    retrievalScores: [],
    degradedReason: null,
  };
}

function rankedCapabilitySources(query: string, ledger: CapabilityLedger): KnowledgeSource[] {
  const grouped = new Map<string, {
    source: KnowledgeSource;
    content: Set<string>;
    topicIds: Set<string>;
  }>();
  for (const assessment of assessCapabilities(query, ledger)) {
    const references = [
      ...assessment.direct.map((reference) => ({ level: 'direct' as const, reference })),
      ...assessment.transferable.map((reference) => ({ level: 'transferable' as const, reference })),
    ].filter(({ reference }) => reference.projectSlug === null);
    for (const { level, reference } of references) {
      const source = capabilitySource(reference, level);
      const key = reference.projectSlug ?? source.documentId;
      const group = grouped.get(key) ?? {
        source: { ...source, chunkId: `${source.documentId}:ledger:jd` },
        content: new Set<string>(),
        topicIds: new Set<string>(),
      };
      group.content.add(source.content);
      group.topicIds.add(reference.capabilityId);
      if (assessment.capabilityId) group.topicIds.add(assessment.capabilityId);
      if (level === 'direct') group.source.evidenceLevel = 'direct';
      grouped.set(key, group);
    }
    const first = references[0];
    if (assessment.boundaryText && assessment.label && first) {
      const source = capabilitySource(first.reference, first.level);
      grouped.get(first.reference.projectSlug ?? source.documentId)?.content.add(
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

function mergeRankedCapabilitySources(
  projects: readonly KnowledgeSource[],
  query: string,
  ledger: CapabilityLedger,
): KnowledgeSource[] {
  return [
    ...projects.map((source) => ({ ...source })),
    ...rankedCapabilitySources(query, ledger),
  ];
}

function evidenceQuery(input: PlanChatEvidenceInput): string {
  const slots = input.frame?.slots
    .map((slot) => slot.text)
    .filter((text) => text !== input.currentInput) ?? [];
  return [...new Set([input.currentInput, ...slots])].join('\n');
}

function deterministicProjectRanks(
  query: string,
  ledger: CapabilityLedger,
): Map<string, { level: 'direct' | 'transferable'; score: number; topicIds: Set<string> }> {
  const ranks = new Map<string, {
    level: 'direct' | 'transferable';
    score: number;
    topicIds: Set<string>;
  }>();
  for (const assessment of assessCapabilities(query, ledger)) {
    for (const [level, references, score] of [
      ['direct', assessment.direct, 2],
      ['transferable', assessment.transferable, 1],
    ] as const) {
      for (const reference of references) {
        if (!reference.projectSlug || !auditedProject(reference.projectSlug)) continue;
        const current = ranks.get(reference.projectSlug);
        if (!current || score > current.score) {
          ranks.set(reference.projectSlug, {
            level,
            score,
            topicIds: new Set([reference.capabilityId]),
          });
        } else {
          current.topicIds.add(reference.capabilityId);
        }
      }
    }
  }
  return ranks;
}

function fallbackProjects(
  query: string,
  ledger: CapabilityLedger,
  degradedReason: 'embedding' | 'retrieval',
): PlannedChatEvidence {
  const ranks = deterministicProjectRanks(query, ledger);
  const projects = [...ranks.entries()]
    .sort((left, right) => (
      right[1].score - left[1].score
      || (projectOrder.get(left[0] as ProjectSlug) ?? Number.MAX_SAFE_INTEGER)
        - (projectOrder.get(right[0] as ProjectSlug) ?? Number.MAX_SAFE_INTEGER)
    ))
    .flatMap(([slug, rank]) => {
      const project = auditedProject(slug);
      return project
        ? [approvedProjectSource(project, rank.level, { topicIds: [...rank.topicIds] })]
        : [];
    });
  const knowledge = mergeRankedCapabilitySources(projects, query, ledger);
  return {
    knowledge,
    admissions: admissions(knowledge, assessCapabilities(query, ledger)),
    retrievalScores: [],
    degradedReason,
  };
}

async function rankedProjects(input: PlanChatEvidenceInput): Promise<PlannedChatEvidence> {
  const query = evidenceQuery(input);
  const queries = partitionCompleteRetrievalQuery(
    query,
    RECRUITMENT_RETRIEVAL_CHUNK_CHARACTERS,
  );
  let embeddings: readonly number[][];
  try {
    if (input.embedAll) {
      embeddings = await input.embedAll(queries);
    } else if (input.embed) {
      embeddings = await Promise.all(queries.map((chunk) => input.embed!(chunk)));
    } else {
      throw new Error('EMBEDDING_UNAVAILABLE');
    }
  } catch {
    return fallbackProjects(query, input.ledger, 'embedding');
  }
  let candidates: KnowledgeSource[];
  try {
    if (input.retrieveAll) {
      candidates = await input.retrieveAll(embeddings);
    } else if (input.retrieve) {
      const results = await Promise.all(embeddings.map((embedding) => input.retrieve!(embedding)));
      const union = new Map<string, KnowledgeSource>();
      for (const source of results.flat()) {
        const existing = union.get(source.chunkId);
        if (!existing || source.score > existing.score) union.set(source.chunkId, source);
      }
      candidates = [...union.values()];
    } else {
      throw new Error('RETRIEVAL_UNAVAILABLE');
    }
  } catch {
    return fallbackProjects(query, input.ledger, 'retrieval');
  }
  const ranks = deterministicProjectRanks(query, input.ledger);
  const grouped = new Map<string, KnowledgeSource>();
  for (const source of candidates) {
    if (!source.projectSlug || !auditedProject(source.projectSlug)
      || !Number.isFinite(source.score) || source.score < LOCAL_EVIDENCE_MIN_SCORE) continue;
    const current = grouped.get(source.projectSlug);
    if (!current || source.score > current.score
      || (source.score === current.score && source.chunkId < current.chunkId)) {
      grouped.set(source.projectSlug, source);
    }
  }
  // Preserve threshold-qualified direct evidence; vector relevance fills the remaining slots.
  const selected = [...grouped.entries()]
    .sort((left, right) => (
      Number(ranks.get(right[0])?.level === 'direct')
        - Number(ranks.get(left[0])?.level === 'direct')
      || right[1].score - left[1].score
      || (projectOrder.get(left[0] as ProjectSlug) ?? Number.MAX_SAFE_INTEGER)
        - (projectOrder.get(right[0] as ProjectSlug) ?? Number.MAX_SAFE_INTEGER)
    ));
  const projects = selected.flatMap(([slug, retrieved]) => {
    const project = auditedProject(slug);
    if (!project) return [];
    const deterministic = ranks.get(slug);
    return [approvedProjectSource(project, deterministic?.level ?? 'transferable', {
      score: retrieved.score,
      retrievedContent: retrieved.content,
      topicIds: deterministic ? [...deterministic.topicIds] : [],
    })];
  });
  const knowledge = mergeRankedCapabilitySources(projects, query, input.ledger);
  return {
    knowledge,
    admissions: admissions(knowledge, assessCapabilities(query, input.ledger)),
    retrievalScores: selected.map(([slug, source]) => ({
      evidenceId: `project:${slug}`,
      score: source.score,
    })),
    degradedReason: null,
  };
}

function directProjects(): PlannedChatEvidence {
  const knowledge = siteContent.projects.map((project) => approvedProjectSource(project, 'direct'));
  return {
    knowledge,
    admissions: knowledge.map(admission),
    retrievalScores: [],
    degradedReason: null,
  };
}

function noEvidence(): PlannedChatEvidence {
  return { knowledge: [], admissions: [], retrievalScores: [], degradedReason: null };
}

async function planLegacyChatEvidence(input: PlanChatEvidenceInput): Promise<PlannedChatEvidence> {
  switch (input.resolved.semantic.intent) {
    case 'identity_fact': {
      const knowledge = [identitySource()];
      return { knowledge, admissions: knowledge.map(admission), retrievalScores: [], degradedReason: null };
    }
    case 'project_catalog':
      return directProjects();
    case 'project_fit':
    case 'jd_match':
      return rankedProjects(input);
    case 'named_project_fact': {
      const slug = input.resolved.semantic.referent?.kind === 'project'
        ? input.resolved.semantic.referent.ref
        : null;
      const project = slug ? auditedProject(slug) : null;
      if (!project) {
        return {
          ...noEvidence(),
          admissions: [{ evidenceId: null, level: 'unavailable', projectSlug: null, capabilityId: null }],
        };
      }
      const knowledge = [approvedProjectSource(project, 'direct')];
      return { knowledge, admissions: knowledge.map(admission), retrievalScores: [], degradedReason: null };
    }
    case 'capability_fact': {
      const capabilityId = input.resolved.semantic.referent?.kind === 'capability'
        ? input.resolved.semantic.referent.ref
        : null;
      const assessments = capabilityId
        ? [assessCapability(capabilityId, input.ledger)]
        : assessCapabilities(input.currentInput, input.ledger);
      return capabilityEvidence(assessments);
    }
    default:
      return noEvidence();
  }
}

function evidenceIdForReference(
  reference: CompiledEvidenceReference,
): string {
  return reference.kind === 'project'
    ? `project:${reference.projectSlug}`
    : `resume-fact:${reference.resumeFactId}`;
}

function approvedForPlan(input: PlanEvidenceBundleInput): {
  approved: KnowledgeSource[];
  unavailableCapabilityIds: string[];
} {
  const allApproved = allApprovedPortfolioEvidence(input.catalog);
  const requestedUnavailableCapabilities = (): string[] => {
    const texts = [
      input.session.currentInput,
      ...input.session.currentFrame?.slots.map((slot) => slot.text) ?? [],
      ...input.plan.candidateFrame?.slots.map((slot) => slot.text) ?? [],
    ];
    return texts
      .flatMap((text) => matchCatalogCapabilities(text, input.catalog))
      .filter((capability) => capability.evidenceClass === 'unavailable')
      .map((capability) => capability.id)
      .filter((id, index, ids) => ids.indexOf(id) === index);
  };
  switch (input.plan.evidence.kind) {
    case 'none':
    case 'controlled_search':
      return { approved: [], unavailableCapabilityIds: [] };
    case 'identity':
      return { approved: [identitySource()], unavailableCapabilityIds: [] };
    case 'portfolio_full':
      return {
        approved: allApproved,
        unavailableCapabilityIds: requestedUnavailableCapabilities(),
      };
    case 'named_projects': {
      const requested = new Set(input.plan.evidence.projectSlugs);
      return {
        approved: allApproved.filter((source) => (
          source.projectSlug !== null
          && source.projectSlug !== undefined
          && requested.has(source.projectSlug as ProjectSlug)
        )),
        unavailableCapabilityIds: [],
      };
    }
    case 'capabilities': {
      const selectedEvidenceIds = new Set<string>();
      const unavailableCapabilityIds: string[] = [];
      for (const capabilityId of input.plan.evidence.capabilityIds) {
        const capability = input.catalog.capabilities.get(capabilityId);
        if (!capability) throw new Error(`CHAT_EVIDENCE_CATALOG_INVALID: unknown capability ${capabilityId}`);
        if (capability.evidenceClass === 'unavailable') {
          unavailableCapabilityIds.push(capability.id);
          continue;
        }
        for (const reference of [...capability.direct, ...capability.transferable]) {
          selectedEvidenceIds.add(evidenceIdForReference(reference));
        }
      }
      return {
        approved: input.plan.evidence.includePortfolio
          ? allApproved
          : allApproved.filter((source) => selectedEvidenceIds.has(source.chunkId)),
        unavailableCapabilityIds,
      };
    }
    default:
      throw new Error('TURN_PLAN_EVIDENCE_UNSUPPORTED');
  }
}

function bundleAdmissions(
  approved: readonly KnowledgeSource[],
  unavailableCapabilityIds: readonly string[],
): EvidenceBundle['admissions'] {
  return [
    ...approved.map((source) => ({
      evidenceId: source.chunkId,
      level: source.evidenceLevel ?? 'direct' as const,
      projectSlug: source.projectSlug ?? null,
      capabilityId: source.topicIds?.find((topic) => topic !== 'resume'
        && !projectOrder.has(topic as ProjectSlug)) ?? null,
    })),
    ...unavailableCapabilityIds.map((capabilityId) => ({
      evidenceId: null,
      level: 'unavailable' as const,
      projectSlug: null,
      capabilityId,
    })),
  ];
}

function emptyRelevance(approved: readonly KnowledgeSource[]): EvidenceBundle['relevance'] {
  return approved.map((source) => ({ evidenceId: source.chunkId, score: null }));
}

async function rankApprovedEvidence(
  input: PlanEvidenceBundleInput,
  approved: readonly KnowledgeSource[],
): Promise<{
  relevance: EvidenceBundle['relevance'];
  degradedReason: EvidenceBundle['degradedReason'];
}> {
  if (approved.length === 0 || (input.plan.evidence.kind === 'portfolio_full'
    && !input.plan.evidence.rankForQuestion)) {
    return { relevance: emptyRelevance(approved), degradedReason: null };
  }
  const queries = partitionCompleteRetrievalQuery(
    input.session.currentInput,
    RECRUITMENT_RETRIEVAL_CHUNK_CHARACTERS,
  );
  let embeddings: readonly number[][];
  try {
    if (input.retrieval.embedAll) {
      embeddings = await input.retrieval.embedAll(queries);
    } else if (input.retrieval.embed) {
      embeddings = await Promise.all(queries.map((query) => input.retrieval.embed!(query)));
    } else {
      throw new Error('EMBEDDING_UNAVAILABLE');
    }
    if (embeddings.length !== queries.length) throw new Error('EMBEDDING_UNAVAILABLE');
  } catch {
    return { relevance: emptyRelevance(approved), degradedReason: 'embedding' };
  }

  let candidates: KnowledgeSource[];
  try {
    if (input.retrieval.retrieveAll) {
      candidates = await input.retrieval.retrieveAll(embeddings);
    } else if (input.retrieval.retrieve) {
      candidates = (await Promise.all(
        embeddings.map((embedding) => input.retrieval.retrieve!(embedding)),
      )).flat();
    } else {
      throw new Error('RETRIEVAL_UNAVAILABLE');
    }
  } catch {
    return { relevance: emptyRelevance(approved), degradedReason: 'retrieval' };
  }

  const scoreFor = (source: KnowledgeSource): number | null => {
    const scores = candidates
      .filter((candidate) => (
        candidate.chunkId === source.chunkId
        || (source.projectSlug && candidate.projectSlug === source.projectSlug)
        || (source.projectSlug === null && candidate.documentId === source.documentId)
      ))
      .map((candidate) => candidate.score)
      .filter(Number.isFinite);
    return scores.length > 0 ? Math.max(...scores) : null;
  };
  return {
    relevance: approved.map((source) => ({
      evidenceId: source.chunkId,
      score: scoreFor(source),
    })),
    degradedReason: null,
  };
}

async function planEvidenceBundle(input: PlanEvidenceBundleInput): Promise<EvidenceBundle> {
  const { approved, unavailableCapabilityIds } = approvedForPlan(input);
  const { relevance, degradedReason } = await rankApprovedEvidence(input, approved);
  return {
    catalogVersion: 2,
    approved,
    admissions: bundleAdmissions(approved, unavailableCapabilityIds),
    relevance,
    unavailableCapabilityIds,
    degradedReason,
  };
}

export function planChatEvidence(input: PlanEvidenceBundleInput): Promise<EvidenceBundle>;
export function planChatEvidence(input: PlanChatEvidenceInput): Promise<PlannedChatEvidence>;
export function planChatEvidence(
  input: PlanEvidenceBundleInput | PlanChatEvidenceInput,
): Promise<EvidenceBundle | PlannedChatEvidence> {
  return 'plan' in input ? planEvidenceBundle(input) : planLegacyChatEvidence(input);
}
