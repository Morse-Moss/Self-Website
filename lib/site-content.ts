import contentJson from "../content/site-content.json" with { type: "json" };

export const projectSlugs = [
  "content-agent",
  "auto-operations",
  "ai-leadgen",
  "deep-research",
  "digital-morse",
] as const;

export type ProjectSlug = (typeof projectSlugs)[number];

export type ProjectDisclosure = "public" | "internal-redacted";

export type TechStackGroup = {
  label: string;
  items: string[];
};

export type ProjectAction = {
  kind: "external";
  label: "GitHub";
  href: string;
};

export type ProjectMedia = {
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
};

export type CaseStudy = {
  problem: string;
  role: string;
  decisions: string[];
  structure: string[];
  evidence: string[];
  boundaries: string[];
};

export type ProjectKnowledgeTopic = {
  id: string;
  title: string;
  content: string;
};

export type ProjectDetails = {
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
};

export type Project = {
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
};

export type SiteFooterLink = {
  label: "GitHub";
  href: string;
};

export type ProfileCapability = {
  id: string;
  title: string;
  description: string;
};

export type SiteContent = {
  site: {
    name: string;
    description: string;
    nav: Array<{ label: string; href: "/" | "/works" }>;
    resumeMode: {
      storageKey: string;
      bodyClass: string;
      toggleLabel: string;
      printLabel: string;
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
  };
  home: { worksIntro: string; featuredSlugs: ProjectSlug[] };
  works: { title: string };
  projects: Project[];
  faq: Array<{ question: string; answer: string }>;
};

export const siteContent = contentJson as SiteContent;

export const getAllProjects = (): Project[] => siteContent.projects;

export const getFeaturedProjects = (): Project[] =>
  siteContent.home.featuredSlugs
    .map((slug) => getProjectBySlug(slug))
    .filter((value): value is Project => Boolean(value));

export const getProjectBySlug = (slug: string): Project | undefined =>
  siteContent.projects.find((project) => project.slug === slug);

export const getProjectStaticParams = (): Array<{ slug: ProjectSlug }> =>
  projectSlugs.map((slug) => ({ slug }));

export const projectHashHref = (
  slug: ProjectSlug,
): `/works#${ProjectSlug}` => `/works#${slug}`;
