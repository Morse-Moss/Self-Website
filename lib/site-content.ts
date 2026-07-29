import contentJson from "../content/site-content.json" with { type: "json" };
import evidenceCatalogJson from "../content/chat-evidence-catalog.json" with { type: "json" };

import type { ChatEvidenceCatalogV2 } from "./contracts/chat-evidence-catalog.ts";
import {
  projectSlugs,
  type Project,
  type ProjectSlug,
  type SiteContent,
} from "./contracts/site-content.ts";

export { projectSlugs } from "./contracts/site-content.ts";
export type {
  CaseStudy,
  ProfileCapability,
  Project,
  ProjectAction,
  ProjectDetails,
  ProjectDisclosure,
  ProjectKnowledgeTopic,
  ProjectMedia,
  ProjectSlug,
  PublicResumeFact,
  SiteContent,
  SiteFooterLink,
  TechStackGroup,
} from "./contracts/site-content.ts";

export const siteUrl = "https://aimorse.tech";

export const siteContent = contentJson as SiteContent;
export const chatEvidenceCatalog = evidenceCatalogJson as ChatEvidenceCatalogV2;

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
