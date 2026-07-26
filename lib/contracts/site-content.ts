export const projectSlugs = [
  'content-agent',
  'auto-operations',
  'ai-leadgen',
  'deep-research',
  'digital-morse',
] as const;

export type ProjectSlug = (typeof projectSlugs)[number];
export type ProjectDisclosure = 'public' | 'internal-redacted';

export interface TechStackGroup {
  label: string;
  items: string[];
}

export interface ProjectAction {
  kind: 'external';
  label: 'GitHub';
  href: string;
}

export interface ProjectMedia {
  src: string;
  width: number;
  height: number;
  alt: string;
  label: string;
  caption: string;
  evidence: {
    capturedAt: string;
    commit: string;
    runMode: string;
    sanitization: string;
  };
}

export interface CaseStudy {
  problem: string;
  role: string;
  decisions: string[];
  structure: string[];
  evidence: string[];
  boundaries: string[];
}

export interface ProjectKnowledgeTopic {
  id: string;
  title: string;
  content: string;
}

export interface ProjectDetails {
  sectionTitles?: {
    overview?: string;
    implementation?: string;
  };
  overview: string[];
  coreCapabilities: string[];
  architecture: {
    description?: string;
    flow?: string;
    modules: string[];
  };
  implementation: {
    summary: string;
    contributions: string[];
    futureDirection?: string;
  };
}

export interface Project {
  slug: ProjectSlug;
  name: string;
  type: string;
  status: string;
  summary: string;
  ownership?: string;
  futureDirection?: string;
  featured: boolean;
  disclosure: ProjectDisclosure;
  capabilities: string[];
  techStack: TechStackGroup[];
  media: ProjectMedia | null;
  actions: ProjectAction[];
  askMorse?: {
    label: string;
    prompt: string;
  };
  knowledgeTopics?: ProjectKnowledgeTopic[];
  details?: ProjectDetails;
  caseStudy: CaseStudy;
}

export interface SiteFooterLink {
  label: 'GitHub';
  href: string;
}

export interface ProfileCapability {
  id: string;
  title: string;
  description: string;
}

export interface PublicResumeFact {
  id: string;
  title: string;
  content: string;
  capabilityIds: string[];
}

export interface SiteContent {
  site: {
    name: string;
    description: string;
    nav: Array<{ label: string; href: '/' | '/works' }>;
    resumeMode: {
      toggleLabel: string;
    };
    footer: {
      morse: string;
      statement: string;
      copyright: string;
      links: SiteFooterLink[];
    };
  };
  profile: {
    kicker: string;
    title: string;
    role: string;
    summary: string;
    capabilities: string[];
    capabilityMatrix: ProfileCapability[];
    principles: string[];
    resumeFacts?: PublicResumeFact[];
  };
  home: { worksIntro: string; featuredSlugs: ProjectSlug[] };
  works: { title: string };
  projects: Project[];
  faq: Array<{ question: string; answer: string }>;
}
