import Image from 'next/image';
import Link from 'next/link';

import OpenChatButton from '@/components/site/OpenChatButton';
import ProjectCard from '@/components/works/ProjectCard';
import {
  getAllProjects,
  getFeaturedProjects,
  siteContent,
} from '@/lib/site-content';

import styles from './page.module.css';

export default function Home() {
  const projects = getAllProjects();
  const featured = getFeaturedProjects()[0];

  return (
    <main>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroInner}>
          <div className={styles.identity}>
            <p className={styles.kicker}>{siteContent.profile.kicker}</p>
            <h1 id="home-title">{siteContent.profile.title}</h1>
            <p className={styles.role}>{siteContent.profile.role}</p>
            <p className={styles.summary}>{siteContent.profile.summary}</p>

            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/works">
                查看作品
              </Link>
              <OpenChatButton className={styles.secondaryAction}>
                问数字摩斯
              </OpenChatButton>
            </div>
          </div>

          {featured?.media ? (
            <figure className={styles.heroEvidence}>
              <Image
                src={featured.media.src}
                width={featured.media.width}
                height={featured.media.height}
                alt={featured.media.alt}
                sizes="(max-width: 640px) 56vw, 510px"
                priority
              />
              <figcaption>
                <span>{featured.name}</span>
                <span>{featured.media.caption}</span>
              </figcaption>
            </figure>
          ) : null}
        </div>
      </section>

      <section className={styles.worksSection} id="selected-works" aria-labelledby="works-title">
        <header className={styles.sectionHeader}>
          <p>SELECTED SYSTEMS</p>
          <h2 id="works-title">作品证据</h2>
          <span>{siteContent.home.worksIntro}</span>
        </header>

        <div className={styles.projectGrid}>
          {projects.map((project) => <ProjectCard key={project.slug} project={project} />)}
        </div>
      </section>
    </main>
  );
}
