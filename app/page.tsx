import Link from 'next/link';

import MorseChat from '@/components/MorseChat';
import MorseHomeSections from '@/components/home/MorseHomeSections';
import OpenChatButton from '@/components/site/OpenChatButton';
import stats from '@/content/stats.json';
import { getFeaturedProjects, siteContent } from '@/lib/site-content';

import styles from './styles/hero.module.css';

export default function Home() {
  return (
    <main>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroInner}>
          <div className={styles.identity} data-reveal>
            <p className={styles.kicker}>AGENT SYSTEM DEVELOPER</p>
            <h1 id="home-title"><span>Morse</span></h1>
            <p className={styles.role}>{siteContent.profile.role}</p>
            <p className={styles.summary}>{siteContent.profile.summary}</p>

            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/works">查看作品</Link>
              <OpenChatButton className={styles.secondaryAction}>问数字摩斯</OpenChatButton>
            </div>
          </div>

          <MorseChat variant="embedded" />
        </div>
      </section>

      <MorseHomeSections
        content={siteContent}
        featuredProjects={getFeaturedProjects()}
        stats={stats}
      />
    </main>
  );
}
