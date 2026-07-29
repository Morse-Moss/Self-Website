import type { KnowledgeSource } from './chat-runtime.ts';
import type {
  Project,
  ProjectDisclosure,
  ProjectSlug,
  PublicResumeFact,
} from './site-content.ts';

export type EvidenceReference =
  | {
      kind: 'project';
      projectSlug: ProjectSlug;
      level: 'direct' | 'transferable';
    }
  | {
      kind: 'resume_fact';
      resumeFactId: string;
      level: 'direct' | 'transferable';
    };

export interface ChatEvidenceCatalogV2 {
  version: 2;
  projects: Array<{
    slug: ProjectSlug;
    aliases: string[];
  }>;
  capabilities: Array<{
    id: string;
    label: string;
    aliases: string[];
    evidenceRefs: EvidenceReference[];
    unavailableBoundary: string | null;
  }>;
}

export interface CompiledProjectEntry {
  slug: ProjectSlug;
  aliases: readonly string[];
  project: Project;
}

export type CompiledEvidenceReference =
  | {
      kind: 'project';
      projectSlug: ProjectSlug;
      projectName: string;
      disclosure: ProjectDisclosure;
      project: Project;
      resumeFactId: null;
      level: 'direct' | 'transferable';
    }
  | {
      kind: 'resume_fact';
      projectSlug: null;
      projectName: string;
      disclosure: 'internal-redacted';
      resumeFactId: string;
      resumeFact: PublicResumeFact;
      level: 'direct' | 'transferable';
    };

export interface CompiledCapabilityEntry {
  id: string;
  label: string;
  aliases: readonly string[];
  evidenceClass: 'direct' | 'transferable' | 'unavailable';
  direct: readonly CompiledEvidenceReference[];
  transferable: readonly CompiledEvidenceReference[];
  unavailableBoundary: string | null;
}

export interface CompiledChatEvidenceCatalog {
  version: 2;
  projects: readonly CompiledProjectEntry[];
  capabilities: ReadonlyMap<string, CompiledCapabilityEntry>;
  unresolvedReferences: readonly string[];
  projectAliases: readonly { slug: ProjectSlug; normalized: string }[];
  capabilityAliases: readonly { capabilityId: string; normalized: string }[];
}

export interface EvidenceBundle {
  catalogVersion: 2;
  approved: readonly KnowledgeSource[];
  admissions: readonly {
    evidenceId: string | null;
    level: 'direct' | 'transferable' | 'unavailable';
    projectSlug: string | null;
    capabilityId: string | null;
  }[];
  relevance: readonly { evidenceId: string; score: number | null }[];
  unavailableCapabilityIds: readonly string[];
  degradedReason: 'embedding' | 'retrieval' | null;
}
