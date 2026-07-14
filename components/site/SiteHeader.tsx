'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ResumeModeToggle } from '@/components/ResumeMode';
import type { SiteContent } from '@/lib/site-content';

import OpenChatButton from './OpenChatButton';
import styles from './SiteShell.module.css';

function isCurrentPath(pathname: string, href: string) {
  return href === '/'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteHeader({ site }: { site: SiteContent['site'] }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const updateScrollState = () => setScrolled(window.scrollY > 12);

    updateScrollState();
    window.addEventListener('scroll', updateScrollState, { passive: true });
    return () => window.removeEventListener('scroll', updateScrollState);
  }, [pathname]);

  return (
    <header className={styles.siteHeader} data-scrolled={scrolled ? 'true' : 'false'}>
      <div className={styles.headerInner}>
        <nav className={styles.navigation} aria-label="主导航">
          {site.nav.map((item) => {
            const isCurrent = isCurrentPath(pathname, item.href);

            return (
              <Link
                className={styles.navLink}
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                key={item.href}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className={styles.headerControls}>
          <OpenChatButton className={styles.headerControl}>问摩斯</OpenChatButton>
          <ResumeModeToggle config={site.resumeMode} inline />
        </div>
      </div>
    </header>
  );
}
