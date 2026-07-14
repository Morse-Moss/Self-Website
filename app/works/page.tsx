import ProjectCard from '@/components/works/ProjectCard';
import { getAllProjects, siteContent } from '@/lib/site-content';

import styles from './page.module.css';

export default function WorksPage() {
  const projects = getAllProjects();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p>WORK INDEX</p>
        <h1>{siteContent.works.title}</h1>
        <span>{siteContent.works.intro}</span>
      </header>

      <div className={styles.projectGrid}>
        {projects.map((project) => <ProjectCard key={project.slug} project={project} />)}
      </div>
    </main>
  );
}
