'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { SiteContent } from '@/lib/site-content';

import styles from './SiteShell.module.css';

export default function SiteHeader({ site }: { site: SiteContent['site'] }) {
  const pathname = usePathname();

  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label={`${site.name}首页`}>
          <span className={styles.brandSignal} aria-hidden="true" />
          {site.name}
        </Link>

        <nav className={styles.navigation} aria-label="主导航">
          {site.nav.map((item) => {
            const isCurrent = item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

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
      </div>
    </header>
  );
}
