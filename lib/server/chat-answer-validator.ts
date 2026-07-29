import type { EvidenceBundle } from '../contracts/chat-evidence-catalog.ts';
import type {
  AnswerCandidate,
  AnswerValidationIssueCode,
  AnswerValidationResult,
  TurnPlanV1,
} from '../contracts/chat-turn-plan.ts';
import {
  compiledChatEvidenceCatalog,
  mentionsCatalogProject,
  normalizeCatalogAlias,
} from './chat-evidence-catalog.ts';

const BLOCKING = new Set<AnswerValidationIssueCode>([
  'private_data_leak',
  'secret_leak',
]);

export interface ValidateAnswerInput {
  plan: TurnPlanV1;
  evidence: EvidenceBundle;
  candidate: AnswerCandidate;
  privacyCanaries: readonly string[];
}

function requestedProjectIds(input: ValidateAnswerInput): string[] {
  if (input.plan.evidence.kind === 'named_projects') {
    return [...input.plan.evidence.projectSlugs];
  }
  if (input.plan.evidence.kind === 'portfolio_full'
    || (input.plan.evidence.kind === 'capabilities' && input.plan.evidence.includePortfolio)) {
    return input.evidence.approved
      .flatMap((source) => source.projectSlug ? [source.projectSlug] : [])
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }
  return [];
}

function requestedCapabilityIds(input: ValidateAnswerInput): string[] {
  return input.plan.evidence.kind === 'capabilities'
    ? [...input.plan.evidence.capabilityIds]
    : [];
}

function mentionsCapability(text: string, capabilityId: string): boolean {
  const capability = compiledChatEvidenceCatalog.capabilities.get(capabilityId);
  if (!capability) return false;
  const normalized = normalizeCatalogAlias(text);
  return [capability.label, ...capability.aliases]
    .some((alias) => normalized.includes(normalizeCatalogAlias(alias)));
}

function hasInvalidCitation(text: string, sourceCount: number): boolean {
  const citations = [...text.matchAll(/\[(?:source|来源)\s*(\d+)\]/giu)]
    .map((match) => Number(match[1]));
  return citations.some((citation) => citation < 1 || citation > sourceCount);
}

function claimsDirectExperience(text: string): boolean {
  return /\b(?:i\s+)?(?:used|built|implemented|deployed|operated)\b|(?:我)?(?:使用过|做过|实现过|部署过|负责过)/iu
    .test(text);
}

function containsSecret(text: string): boolean {
  return /Authorization\s*:\s*Bearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:postgres|postgresql):\/\/\S+|\b(?:api[_-]?key|secret[_-]?key)\s*[:=]\s*\S+/iu
    .test(text);
}

export function validateAnswer(input: ValidateAnswerInput): AnswerValidationResult {
  const issues = new Set<AnswerValidationIssueCode>();
  const text = input.candidate.text;
  const missingProject = requestedProjectIds(input).some((projectId) => {
    const project = compiledChatEvidenceCatalog.projects.find((entry) => entry.slug === projectId);
    return !project || !mentionsCatalogProject(text, project.slug, compiledChatEvidenceCatalog);
  });
  const missingCapability = requestedCapabilityIds(input).some((capabilityId) => (
    !mentionsCapability(text, capabilityId)
  ));
  if (missingProject || missingCapability) issues.add('missing_evidence_coverage');
  if (hasInvalidCitation(text, input.evidence.approved.length)) issues.add('invalid_citation');

  const unsupported = requestedCapabilityIds(input).some((capabilityId) => (
    input.evidence.unavailableCapabilityIds.includes(capabilityId)
      && mentionsCapability(text, capabilityId)
      && claimsDirectExperience(text)
  ));
  if (unsupported) issues.add('unsupported_capability_claim');
  if (input.privacyCanaries.some((canary) => canary.length > 0 && text.includes(canary))) {
    issues.add('private_data_leak');
  }
  if (containsSecret(text)) issues.add('secret_leak');

  const projected = [...issues].map((code) => ({ code, evidenceId: null }));
  return {
    verdict: projected.some((issue) => BLOCKING.has(issue.code))
      ? 'block'
      : projected.length > 0
        ? 'warn'
        : 'pass',
    issues: projected,
  };
}
