import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, TransitionEvent } from 'react';

import type { Project } from '@/lib/site-content';

import CaseStudy from './CaseStudy';
import styles from './ProjectCard.module.css';

const DETAIL_TRANSITION_FALLBACK_MS = 500;

type ProjectCardProps = {
  project: Project;
  expanded: boolean;
  onToggle: () => void;
};

export default function ProjectCard({
  project,
  expanded,
  onToggle,
}: ProjectCardProps) {
  const titleId = `project-title-${project.slug}`;
  const detailsId = `project-details-${project.slug}`;
  const [detailsMounted, setDetailsMounted] = useState(expanded);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsMountedRef = useRef(expanded);
  const openFrame = useRef<number | null>(null);
  const closeFallback = useRef<number | null>(null);
  const presenceRun = useRef(0);

  useEffect(() => {
    const run = ++presenceRun.current;

    if (openFrame.current !== null) {
      cancelAnimationFrame(openFrame.current);
      openFrame.current = null;
    }
    if (closeFallback.current !== null) {
      window.clearTimeout(closeFallback.current);
      closeFallback.current = null;
    }

    if (expanded) {
      detailsMountedRef.current = true;
      setDetailsMounted(true);
      openFrame.current = requestAnimationFrame(() => {
        openFrame.current = null;
        if (presenceRun.current === run) {
          setDetailsOpen(true);
        }
      });
    } else {
      setDetailsOpen(false);
      if (detailsMountedRef.current) {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          detailsMountedRef.current = false;
          setDetailsMounted(false);
        } else {
          closeFallback.current = window.setTimeout(() => {
            closeFallback.current = null;
            if (presenceRun.current === run) {
              detailsMountedRef.current = false;
              setDetailsMounted(false);
            }
          }, DETAIL_TRANSITION_FALLBACK_MS);
        }
      }
    }

    return () => {
      presenceRun.current += 1;
      if (openFrame.current !== null) {
        cancelAnimationFrame(openFrame.current);
        openFrame.current = null;
      }
      if (closeFallback.current !== null) {
        window.clearTimeout(closeFallback.current);
        closeFallback.current = null;
      }
    };
  }, [expanded]);

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('a, button, [data-project-details]')) {
      return;
    }

    onToggle();
  }

  function handleDetailsTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (expanded || event.propertyName !== 'grid-template-rows') {
      return;
    }
    if (event.target !== event.currentTarget) {
      return;
    }

    presenceRun.current += 1;
    if (closeFallback.current !== null) {
      window.clearTimeout(closeFallback.current);
      closeFallback.current = null;
    }
    detailsMountedRef.current = false;
    setDetailsMounted(false);
  }

  return (
    <article
      id={project.slug}
      data-project-slug={project.slug}
      data-expanded={expanded}
      className={styles.card}
      aria-labelledby={titleId}
      onClick={handleCardClick}
    >
      <div className={styles.media}>
        {project.media ? (
          <Image
            className={styles.image}
            src={project.media.src}
            width={project.media.width}
            height={project.media.height}
            alt={project.media.alt}
            sizes="(max-width: 640px) 34vw, (max-width: 1100px) 22vw, 220px"
          />
        ) : (
          <div
            className={styles.mediaPlaceholder}
            role="img"
            aria-label={`${project.name}暂无可公开截图`}
          >截图待补</div>
        )}
      </div>

      <div className={styles.content}>
        <div className={styles.meta}>
          <span className={styles.status}>{project.status}</span>
          <span aria-hidden="true">/</span>
          <span>{project.type}</span>
        </div>
        <h2 id={titleId}>{project.name}</h2>
        <p className={styles.summary}>{project.summary}</p>

        <ul className={styles.capabilities} aria-label={`${project.name}能力`}>
          {project.capabilities.map((capability) => (
            <li key={capability}>{capability}</li>
          ))}
        </ul>

        <div className={styles.actions} aria-label={`${project.name}操作`}>
          <button
            className={styles.toggle}
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={onToggle}
          >
            {expanded ? '收起详情' : '展开详情'}
          </button>

          {project.actions.map((action) => (
            <a
              key={action.href}
              className={styles.action}
              href={action.href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              {action.label}
            </a>
          ))}
        </div>
      </div>

      {detailsMounted ? (
        <div
          className={styles.details}
          data-project-details
          data-open={detailsOpen}
          aria-hidden={!detailsOpen}
          inert={!detailsOpen}
          onTransitionEnd={handleDetailsTransitionEnd}
        >
          <div className={styles.detailsInner}>
            <CaseStudy
              project={project}
              detailsId={detailsId}
              labelledBy={titleId}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
