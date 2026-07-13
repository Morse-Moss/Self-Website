import Image from 'next/image';

import type { Project } from '@/lib/site-content';

import styles from './CaseStudy.module.css';

type CaseStudyProps = {
  project: Project;
};

export default function CaseStudy({ project }: CaseStudyProps) {
  const externalActions = project.actions.filter((action) => action.kind !== 'case');

  return (
    <article className={styles.caseStudy}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{project.type}</p>
        <h1>{project.name}</h1>
        <p className={styles.status}>{project.status}</p>
        <p className={styles.summary}>{project.summary}</p>

        {externalActions.length ? (
          <div className={styles.actions} aria-label={`${project.name}操作`}>
            {externalActions.map((action) => (
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
        ) : null}
      </header>

      {project.media ? (
        <figure className={styles.evidenceFigure}>
          <div className={styles.evidenceImage}>
            <Image
              src={project.media.src}
              width={project.media.width}
              height={project.media.height}
              alt={project.media.alt}
              sizes="(max-width: 640px) 100vw, 510px"
              unoptimized
              priority
            />
          </div>
          <div className={styles.evidenceNote}>
            <figcaption>{project.media.caption}</figcaption>
            <dl>
              <div>
                <dt>采集时间</dt>
                <dd>{project.media.evidence.capturedAt}</dd>
              </div>
              <div>
                <dt>提交版本</dt>
                <dd>{project.media.evidence.commit}</dd>
              </div>
              <div>
                <dt>运行方式</dt>
                <dd>{project.media.evidence.runMode}</dd>
              </div>
              <div>
                <dt>脱敏处理</dt>
                <dd>{project.media.evidence.sanitization}</dd>
              </div>
            </dl>
          </div>
        </figure>
      ) : (
        <div
          className={styles.noEvidenceImage}
          role="img"
          aria-label={`${project.name}暂无可公开截图`}
        >截图待补</div>
      )}

      <div className={styles.sections}>
        <section>
          <p className={styles.sectionIndex}>01</p>
          <div>
            <h2>问题</h2>
            <p>{project.caseStudy.problem}</p>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>02</p>
          <div>
            <h2>我的角色</h2>
            <p>{project.caseStudy.role}</p>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>03</p>
          <div>
            <h2>关键判断</h2>
            <ul>
              {project.caseStudy.decisions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>04</p>
          <div>
            <h2>真实结构</h2>
            <ul>
              {project.caseStudy.structure.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>05</p>
          <div>
            <h2>验证证据</h2>
            <ul>
              {project.caseStudy.evidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>06</p>
          <div>
            <h2>当前边界</h2>
            <ul>
              {project.caseStudy.boundaries.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </div>
    </article>
  );
}
