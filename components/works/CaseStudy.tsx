import OpenChatButton from '@/components/site/OpenChatButton';
import type { Project, ProjectDetails } from '@/lib/site-content';

import styles from './CaseStudy.module.css';

type CaseStudyProps = {
  project: Project;
  detailsId: string;
  labelledBy: string;
};

export default function CaseStudy({
  project,
  detailsId,
  labelledBy,
}: CaseStudyProps) {
  const details: ProjectDetails = project.details ?? {
    overview: [project.summary],
    coreCapabilities: project.capabilities,
    architecture: { modules: project.caseStudy.structure },
    implementation: {
      summary: project.caseStudy.role,
      contributions: project.caseStudy.decisions,
      futureDirection: project.futureDirection,
    },
  };
  const hasActions = Boolean(project.askMorse || project.actions.length);

  return (
    <section
      id={detailsId}
      data-project-details
      className={styles.caseStudy}
      role="region"
      aria-labelledby={labelledBy}
    >
      <div className={styles.sections}>
        <section>
          <p className={styles.sectionIndex}>01</p>
          <div>
            <h3>项目简介</h3>
            {details.overview.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>02</p>
          <div>
            <h3>核心能力</h3>
            <ul>
              {details.coreCapabilities.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>03</p>
          <div>
            <h3>系统架构</h3>
            {details.architecture.flow ? (
              <p className={styles.architectureFlow}>
                {details.architecture.flow}
              </p>
            ) : null}
            <ul className={styles.architectureModules}>
              {details.architecture.modules.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>04</p>
          <div>
            <h3>我的技术实现</h3>
            <p>{details.implementation.summary}</p>
            <ul>
              {details.implementation.contributions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {details.implementation.futureDirection ? (
              <p className={styles.futureDirection}>
                <span>未来方向</span>
                {details.implementation.futureDirection}
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <p className={styles.sectionIndex}>05</p>
          <div>
            <h3>技术栈</h3>
            <dl className={styles.stackGroups}>
              {project.techStack.map((group) => (
                <div key={group.label}>
                  <dt>{group.label}</dt>
                  <dd>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>

      {hasActions ? (
        <div className={styles.actions} aria-label={`${project.name}操作`}>
          {project.askMorse ? (
            <OpenChatButton className={styles.action} prompt={project.askMorse.prompt}>
              {project.askMorse.label}
            </OpenChatButton>
          ) : null}

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
      ) : null}
    </section>
  );
}
