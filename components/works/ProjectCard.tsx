import Image from 'next/image';
import type { MouseEvent } from 'react';

import type { Project } from '@/lib/site-content';

import CaseStudy from './CaseStudy';
import styles from './ProjectCard.module.css';

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

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('a, button, [data-project-details]')) {
      return;
    }

    onToggle();
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

      {expanded ? (
        <CaseStudy
          project={project}
          detailsId={detailsId}
          labelledBy={titleId}
        />
      ) : null}
    </article>
  );
}
