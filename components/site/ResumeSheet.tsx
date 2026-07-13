import { ResumePrintButton } from '@/components/ResumeMode';
import type { SiteContent } from '@/lib/site-content';

import styles from './SiteShell.module.css';

type ResumeSheetProps = {
  printLabel: string;
  profile: SiteContent['profile'];
  projects: SiteContent['projects'];
};

export default function ResumeSheet({ printLabel, profile, projects }: ResumeSheetProps) {
  return (
    <section className={styles.resumeSheet} data-resume-section aria-label="一页纸简历">
      <div className={styles.resumePaper}>
        <header className={styles.resumeHeader}>
          <div>
            <p className={styles.resumeKicker}>{profile.title}</p>
            <h1>{profile.role}</h1>
          </div>
          <ResumePrintButton label={printLabel} />
        </header>

        <p className={styles.resumeSummary}>{profile.summary}</p>

        <section className={styles.resumeBlock} aria-labelledby="resume-principles">
          <h2 id="resume-principles">工程原则</h2>
          <ol className={styles.principleList}>
            {profile.principles.map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ol>
        </section>

        <section className={styles.resumeBlock} aria-labelledby="resume-projects">
          <h2 id="resume-projects">项目经历</h2>
          <ul className={styles.projectList}>
            {projects.map((project) => (
              <li key={project.slug}>
                <strong>{project.name}</strong>
                <span>{project.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
