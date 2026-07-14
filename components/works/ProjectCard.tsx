import Image from 'next/image';

import type { Project } from '@/lib/site-content';

import styles from './ProjectCard.module.css';

type ProjectCardProps = {
  project: Project;
};

export default function ProjectCard({ project }: ProjectCardProps) {
  const titleId = `project-${project.slug}`;

  return (
    <article className={styles.card} aria-labelledby={titleId}>
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
        <h3 id={titleId}>{project.name}</h3>
        <p className={styles.summary}>{project.summary}</p>

        <div className={styles.actions} aria-label={`${project.name}操作`}>
          {project.actions.map((action) => (
            <a
              key={action.href}
              className={styles.action}
              href={action.href}
              target="_blank"
              rel="noreferrer"
            >
              {action.label}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}
