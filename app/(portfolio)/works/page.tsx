import ProjectGallery from '@/components/works/ProjectGallery';
import { getAllProjects, siteContent } from '@/lib/site-content';

import styles from './page.module.css';

export default function WorksPage() {
  const projects = getAllProjects();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>{siteContent.works.title}</h1>
      </header>

      <ProjectGallery projects={projects} />
    </main>
  );
}
