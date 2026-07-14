import contentJson from "../content/site-content.json" with { type: "json" };

export const projectSlugs = [
  "content-agent",
  "auto-operations",
  "deep-research",
  "digital-morse",
] as const;

export type ProjectSlug = (typeof projectSlugs)[number];

export type ProjectAction = {
  kind: "case" | "external";
  label: "查看案例" | "访问系统" | "GitHub";
  href: string;
};

export type ProjectMedia = {
  src: string;
  width: number;
  height: number;
  alt: string;
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

export type Project = {
  slug: ProjectSlug;
  name: string;
  type: string;
  status: string;
  summary: string;
  featured: boolean;
  media: ProjectMedia | null;
  actions: ProjectAction[];
  caseStudy: CaseStudy;
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
    footer: { morse: string; statement: string; copyright: string };
  };
  profile: {
    kicker: string;
    title: string;
    role: string;
    summary: string;
    principles: string[];
  };
  home: { worksIntro: string; featuredSlugs: ProjectSlug[] };
  works: { title: string; intro: string };
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
