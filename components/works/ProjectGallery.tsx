'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  projectSlugs,
  type Project,
  type ProjectSlug,
} from '@/lib/site-content';

import ProjectCard from './ProjectCard';
import styles from './ProjectGallery.module.css';

type ProjectGalleryProps = {
  projects: Project[];
};

function scrollToProject(next: ProjectSlug) {
  const target = document.getElementById(next);
  if (!target) {
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  target.scrollIntoView({
    block: 'start',
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
}

export default function ProjectGallery({ projects }: ProjectGalleryProps) {
  const [openSlug, setOpenSlug] = useState<ProjectSlug | null>(null);
  const pendingTargetTop = useRef<number | null>(null);

  function rememberProjectPosition(slug: ProjectSlug | null) {
    pendingTargetTop.current = slug
      ? document.getElementById(slug)?.getBoundingClientRect().top ?? null
      : null;
  }

  useEffect(() => {
    const syncFromHash = () => {
      const slug = window.location.hash.slice(1);
      const nextSlug = projectSlugs.includes(slug as ProjectSlug)
        ? (slug as ProjectSlug) : null;

      rememberProjectPosition(nextSlug);
      setOpenSlug(nextSlug);
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useLayoutEffect(() => {
    if (!openSlug) {
      pendingTargetTop.current = null;
      return;
    }

    const target = document.getElementById(openSlug);
    const previousTop = pendingTargetTop.current;
    pendingTargetTop.current = null;
    if (!target || previousTop === null) {
      return;
    }

    const currentTop = target.getBoundingClientRect().top;
    const scrollMarginTop = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const wasVisible = previousTop >= scrollMarginTop && previousTop < window.innerHeight;
    const preservedTop = wasVisible ? previousTop : scrollMarginTop;
    window.scrollBy({
      top: currentTop - preservedTop,
      behavior: 'auto',
    });
  }, [openSlug]);

  useEffect(() => {
    if (!openSlug) {
      return;
    }

    const scrollFrame = requestAnimationFrame(() => scrollToProject(openSlug));
    return () => {
      cancelAnimationFrame(scrollFrame);
      window.scrollTo({
        top: window.scrollY,
        behavior: 'auto',
      });
    };
  }, [openSlug]);

  function toggle(slug: ProjectSlug) {
    const next = openSlug === slug ? null : slug;

    rememberProjectPosition(next);
    setOpenSlug(next);
    history.replaceState(null, '', next ? `/works#${next}` : '/works');
  }

  return (
    <div className={styles.gallery}>
      {projects.map((project) => (
        <ProjectCard
          key={project.slug}
          project={project}
          expanded={openSlug === project.slug}
          onToggle={() => toggle(project.slug)}
        />
      ))}
    </div>
  );
}
