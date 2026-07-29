import type {
  ChatEvidenceCatalogV2,
  CompiledCapabilityEntry,
  CompiledChatEvidenceCatalog,
  CompiledEvidenceReference,
} from '../contracts/chat-evidence-catalog.ts';
import type {
  ProjectDisclosure,
  ProjectSlug,
  SiteContent,
} from '../contracts/site-content.ts';
import {
  compileChatEvidenceCatalog,
  matchCatalogCapabilities,
  normalizeCatalogAlias,
} from './chat-evidence-catalog.ts';

export type CapabilityEvidenceClass = 'direct' | 'transferable' | 'none';
export type CapabilityLedger = CompiledChatEvidenceCatalog;

export interface CapabilityEvidenceRef {
  capabilityId: string;
  label: string;
  projectSlug: ProjectSlug | null;
  projectName: string;
  disclosure: ProjectDisclosure;
  sourceKind: 'capability' | 'tech_stack' | 'resume_fact';
  sourceText: string;
}

export interface CapabilityAssessment {
  capabilityId: string | null;
  label: string | null;
  evidenceClass: CapabilityEvidenceClass;
  direct: CapabilityEvidenceRef[];
  transferable: CapabilityEvidenceRef[];
  boundaryText: string | null;
}

export function containsCapabilityAlias(value: string, alias: string): boolean {
  const normalizedAlias = normalizeCatalogAlias(alias);
  if (!normalizedAlias) return false;
  if (/^[a-z0-9]{2,8}$/u.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(
      value.normalize('NFKC').toLocaleLowerCase('en-US'),
    );
  }
  return normalizeCatalogAlias(value).includes(normalizedAlias);
}

export function compileCapabilityLedger(
  content: SiteContent,
  catalog: ChatEvidenceCatalogV2,
): CapabilityLedger {
  return compileChatEvidenceCatalog(content, catalog);
}

function sourceText(reference: CompiledEvidenceReference): string {
  if (reference.kind === 'resume_fact') return reference.resumeFact.content;
  return [
    reference.project.summary,
    ...reference.project.capabilities,
    ...reference.project.techStack.flatMap((group) => group.items),
  ].join('；');
}

function legacyReference(
  capabilityId: string,
  label: string,
  reference: CompiledEvidenceReference,
): CapabilityEvidenceRef {
  return {
    capabilityId,
    label,
    projectSlug: reference.projectSlug,
    projectName: reference.projectName,
    disclosure: reference.disclosure,
    sourceKind: reference.kind === 'resume_fact' ? 'resume_fact' : 'capability',
    sourceText: sourceText(reference),
  };
}

function assessment(
  entry: CompiledCapabilityEntry,
): CapabilityAssessment {
  return {
    capabilityId: entry.id,
    label: entry.label,
    evidenceClass: entry.evidenceClass === 'unavailable' ? 'none' : entry.evidenceClass,
    direct: entry.direct.map((reference) => legacyReference(entry.id, entry.label, reference)),
    transferable: entry.transferable.map((reference) => (
      legacyReference(entry.id, entry.label, reference)
    )),
    boundaryText: entry.unavailableBoundary,
  };
}

export function assessCapability(
  question: string,
  ledger: CapabilityLedger,
): CapabilityAssessment {
  const exact = ledger.capabilities.get(question.trim());
  const match = exact ?? matchCatalogCapabilities(question, ledger)[0];
  return match ? assessment(match) : {
    capabilityId: null,
    label: null,
    evidenceClass: 'none',
    direct: [],
    transferable: [],
    boundaryText: null,
  };
}

export function assessCapabilities(
  question: string,
  ledger: CapabilityLedger,
): CapabilityAssessment[] {
  return matchCatalogCapabilities(question, ledger).map(assessment);
}
