import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import CaseStudy from '@/components/works/CaseStudy';
import {
  getProjectBySlug,
  getProjectStaticParams,
  siteContent,
} from '@/lib/site-content';

import styles from './page.module.css';

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
  const project = requireProject(slug);

  return (
    <main className={styles.main}>
      <CaseStudy project={project} />
    </main>
  );
}
