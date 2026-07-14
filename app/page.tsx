import Link from 'next/link';

import DigitalHuman from '@/components/DigitalHuman';
import MorseChat from '@/components/MorseChat';
import { ResumeModeToggle } from '@/components/ResumeMode';
import ScrollEffects from '@/components/ScrollEffects';
import RestoredHomeSections from '@/components/home/RestoredHomeSections';
import OpenChatButton from '@/components/site/OpenChatButton';
import ResumeSheet from '@/components/site/ResumeSheet';
import stats from '@/content/stats.json';
import { siteContent } from '@/lib/site-content';

import styles from './styles/hero.module.css';

export default function Home() {
  return (
    <>
      <ResumeModeToggle config={siteContent.site.resumeMode} />
      <ScrollEffects />

      <div data-standard-content>
        <main>
          <section className={styles.hero} aria-labelledby="home-title">
            <DigitalHuman />

            <div className={styles.container}>
              <div className={styles.content}>
                <p className={styles.eyebrow}>{siteContent.profile.kicker}</p>
                <h1 className={styles.title} id="home-title">{siteContent.profile.title}</h1>
                <p className={styles.role}>{siteContent.profile.role}</p>
                <p className={styles.sub}>{siteContent.profile.summary}</p>

                <ul className={styles.chips} aria-label="核心能力">
                  {siteContent.profile.capabilities.map((capability) => (
                    <li className={styles.chip} key={capability}>{capability}</li>
                  ))}
                </ul>

                <div className={styles.actions}>
                  <Link className={styles.primaryAction} href="#systems">查看系统</Link>
                  <OpenChatButton className={styles.secondaryAction}>问数字摩斯</OpenChatButton>
                </div>
              </div>
            </div>
          </section>

          <RestoredHomeSections content={siteContent} stats={stats} />
        </main>
      </div>

      <ResumeSheet
        printLabel={siteContent.site.resumeMode.printLabel}
        profile={siteContent.profile}
        projects={siteContent.projects}
      />
      <MorseChat />
    </>
  );
}
