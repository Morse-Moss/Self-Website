import type {
  ProjectDisclosure,
  ProjectSlug,
  SiteContent,
} from '../site-content.ts';

export type CapabilityEvidenceClass = 'direct' | 'transferable' | 'none';

export interface CapabilityPolicyEntry {
  id: string;
  label: string;
  aliases: string[];
}

export interface CapabilityTransferRule {
  target: string;
  from: string[];
  allowedWording: string;
}

export interface CapabilityPolicy {
  version: 1;
  canonical: CapabilityPolicyEntry[];
  transferRules: CapabilityTransferRule[];
}

export interface CapabilityEvidenceRef {
  capabilityId: string;
  label: string;
  projectSlug: ProjectSlug | null;
  projectName: string;
  disclosure: ProjectDisclosure;
  sourceKind: 'capability' | 'tech_stack' | 'resume_fact';
  sourceText: string;
}

interface CapabilityLedgerEntry extends CapabilityPolicyEntry {
  direct: CapabilityEvidenceRef[];
}

interface CapabilityAlias {
  capabilityId: string;
  normalized: string;
}

export interface CapabilityLedger {
  version: 1;
  aliases: CapabilityAlias[];
  entries: ReadonlyMap<string, CapabilityLedgerEntry>;
  transferRules: readonly CapabilityTransferRule[];
}

export interface CapabilityAssessment {
  capabilityId: string | null;
  label: string | null;
  evidenceClass: CapabilityEvidenceClass;
  direct: CapabilityEvidenceRef[];
  transferable: CapabilityEvidenceRef[];
  boundaryText: string | null;
}

function invalidPolicy(detail: string): never {
  throw new Error(`CAPABILITY_POLICY_INVALID: ${detail}`);
}

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

export function containsCapabilityAlias(value: string, alias: string): boolean {
  const normalizedAlias = normalize(alias);
  if (!normalizedAlias) return false;
  if (/^[a-z0-9]{2,8}$/u.test(normalizedAlias)) {
    const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'u').test(
      value.normalize('NFKC').toLocaleLowerCase('en-US'),
    );
  }
  return normalize(value).includes(normalizedAlias);
}

function validateId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    invalidPolicy(`invalid capability id ${id}`);
  }
}

export function compileCapabilityLedger(
  content: SiteContent,
  policy: CapabilityPolicy,
): CapabilityLedger {
  if (policy.version !== 1) invalidPolicy('unsupported version');

  const entries = new Map<string, CapabilityLedgerEntry>();
  const aliasOwners = new Map<string, string>();
  for (const candidate of policy.canonical) {
    validateId(candidate.id);
    if (entries.has(candidate.id)) invalidPolicy(`duplicate id ${candidate.id}`);
    if (!candidate.label.trim() || candidate.aliases.length === 0) {
      invalidPolicy(`missing label or aliases for ${candidate.id}`);
    }

    const aliases = candidate.aliases.map((alias) => alias.trim());
    for (const alias of aliases) {
      const normalized = normalize(alias);
      if (!normalized) invalidPolicy(`empty alias for ${candidate.id}`);
      const owner = aliasOwners.get(normalized);
      if (owner && owner !== candidate.id) {
        invalidPolicy(`alias ${alias} belongs to both ${owner} and ${candidate.id}`);
      }
      aliasOwners.set(normalized, candidate.id);
    }
    entries.set(candidate.id, { ...candidate, aliases, direct: [] });
  }

  for (const project of content.projects) {
    const sources = [
      ...project.capabilities.map((sourceText) => ({ sourceKind: 'capability' as const, sourceText })),
      ...project.techStack.flatMap((group) => group.items.map((sourceText) => ({
        sourceKind: 'tech_stack' as const,
        sourceText,
      }))),
    ];
    for (const source of sources) {
      const owner = aliasOwners.get(normalize(source.sourceText));
      if (!owner) continue;
      const entry = entries.get(owner);
      if (!entry) invalidPolicy(`missing canonical entry for ${owner}`);
      entry.direct.push({
        capabilityId: owner,
        label: entry.label,
        projectSlug: project.slug,
        projectName: project.name,
        disclosure: project.disclosure,
        sourceKind: source.sourceKind,
        sourceText: source.sourceText,
      });
    }
  }

  for (const fact of content.profile.resumeFacts ?? []) {
    if (!fact.id.trim() || !fact.title.trim() || !fact.content.trim()) {
      invalidPolicy('invalid resume fact ' + fact.id);
    }
    for (const capabilityId of fact.capabilityIds) {
      const entry = entries.get(capabilityId);
      if (!entry) invalidPolicy('resume fact ' + fact.id + ' references unknown capability ' + capabilityId);
      entry.direct.push({
        capabilityId,
        label: entry.label,
        projectSlug: null,
        projectName: fact.title,
        disclosure: 'internal-redacted',
        sourceKind: 'resume_fact',
        sourceText: fact.content,
      });
    }
  }

  for (const rule of policy.transferRules) {
    if (!entries.has(rule.target)) invalidPolicy(`unknown transfer target ${rule.target}`);
    if (rule.from.length === 0 || !rule.allowedWording.trim()) {
      invalidPolicy(`incomplete transfer rule for ${rule.target}`);
    }
    for (const sourceId of rule.from) {
      const source = entries.get(sourceId);
      if (!source) invalidPolicy(`unknown transfer source ${sourceId}`);
      if (sourceId === rule.target) invalidPolicy(`self transfer for ${rule.target}`);
      if (source.direct.length === 0) {
        invalidPolicy(`transfer source ${sourceId} is absent from public site content`);
      }
    }
  }

  const aliases = [...aliasOwners].map(([normalized, capabilityId]) => ({
    capabilityId,
    normalized,
  })).sort((left, right) => right.normalized.length - left.normalized.length);

  return {
    version: 1,
    aliases,
    entries,
    transferRules: policy.transferRules.map((rule) => ({
      ...rule,
      from: [...rule.from],
    })),
  };
}

export function assessCapability(
  question: string,
  ledger: CapabilityLedger,
): CapabilityAssessment {
  return assessCapabilities(question, ledger)[0] ?? {
    capabilityId: null,
    label: null,
    evidenceClass: 'none',
    direct: [],
    transferable: [],
    boundaryText: null,
  };
}

function assessLedgerEntry(
  capabilityId: string,
  ledger: CapabilityLedger,
): CapabilityAssessment {
  const entry = ledger.entries.get(capabilityId);
  if (!entry) invalidPolicy(`missing compiled entry for ${capabilityId}`);
  if (entry.direct.length > 0) {
    return {
      capabilityId: entry.id,
      label: entry.label,
      evidenceClass: 'direct',
      direct: [...entry.direct],
      transferable: [],
      boundaryText: null,
    };
  }

  const rule = ledger.transferRules.find((candidate) => candidate.target === entry.id);
  const transferable = rule?.from.flatMap((sourceId) => (
    ledger.entries.get(sourceId)?.direct ?? []
  )) ?? [];
  if (rule && transferable.length > 0) {
    return {
      capabilityId: entry.id,
      label: entry.label,
      evidenceClass: 'transferable',
      direct: [],
      transferable: [...transferable],
      boundaryText: rule.allowedWording,
    };
  }

  return {
    capabilityId: entry.id,
    label: entry.label,
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
  const normalizedQuestion = normalize(question);
  const matches = ledger.aliases
    .filter((alias) => containsCapabilityAlias(question, alias.normalized))
    .map((alias) => ({
      ...alias,
      position: normalizedQuestion.indexOf(alias.normalized),
    }))
    .sort((left, right) => (
      left.position - right.position || right.normalized.length - left.normalized.length
    ));
  const capabilityIds: string[] = [];
  for (const match of matches) {
    if (!capabilityIds.includes(match.capabilityId)) capabilityIds.push(match.capabilityId);
  }
  return capabilityIds.map((capabilityId) => assessLedgerEntry(capabilityId, ledger));
}
