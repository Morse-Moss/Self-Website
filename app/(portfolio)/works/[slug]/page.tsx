import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import {
  getProjectBySlug,
  getProjectStaticParams,
  siteContent,
} from '@/lib/site-content';

type WorkCasePageProps = {
  params: Promise<{ slug: string }>;
};

function requireProject(slug: string) {
  const project = getProjectBySlug(slug);
  if (!project) {
    notFound();
  }
  return project;
}

export function generateStaticParams() {
  return getProjectStaticParams();
}

export async function generateMetadata({
  params,
}: WorkCasePageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = requireProject(slug);

  return {
    title: `${project.name} | ${siteContent.site.name}`,
    description: project.summary,
  };
}

export default async function WorkCasePage({ params }: WorkCasePageProps) {
  const { slug } = await params;
  requireProject(slug);

  redirect(`/works#${slug}`);
}
