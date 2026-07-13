import type { ReactNode } from 'react';

import MorseChat from '@/components/MorseChat';
import { ResumeModeToggle } from '@/components/ResumeMode';
import { siteContent } from '@/lib/site-content';

import ResumeSheet from './ResumeSheet';
import SiteFooter from './SiteFooter';
import SiteHeader from './SiteHeader';
import styles from './SiteShell.module.css';

export default function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <ResumeModeToggle config={siteContent.site.resumeMode} />

      <div className={styles.standardContent} data-standard-content>
        <SiteHeader site={siteContent.site} />
        {children}
        <SiteFooter footer={siteContent.site.footer} />
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
