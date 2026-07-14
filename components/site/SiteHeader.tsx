'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ResumeModeToggle } from '@/components/ResumeMode';
import type { SiteContent } from '@/lib/site-content';

import OpenChatButton from './OpenChatButton';
import styles from './SiteShell.module.css';

export default function SiteHeader({ site }: { site: SiteContent['site'] }) {
  const pathname = usePathname();

  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <nav className={styles.navigation} aria-label="主导航">
          <Link
            className={styles.navLink}
            href="/"
            aria-current={pathname === '/' ? 'page' : undefined}
          >
            首页
          </Link>
          <Link
            className={styles.navLink}
            href="/works"
            aria-current={pathname === '/works' || pathname.startsWith('/works/') ? 'page' : undefined}
          >
            作品集
          </Link>
        </nav>

        <div className={styles.headerControls}>
          <OpenChatButton className={styles.headerControl}>问摩斯</OpenChatButton>
          <ResumeModeToggle config={site.resumeMode} inline />
        </div>
      </div>
    </header>
  );
}
