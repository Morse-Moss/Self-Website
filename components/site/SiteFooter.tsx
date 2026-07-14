import type { SiteContent } from '@/lib/site-content';

import styles from './SiteShell.module.css';

export default function SiteFooter({ footer }: { footer: SiteContent['site']['footer'] }) {
  return (
    <footer className={styles.siteFooter} data-site-footer>
      <div className={styles.footerInner}>
        <div className={styles.footerCopy}>
          <span className={styles.footerMorse}>{footer.morse}</span>
          <span>{footer.statement}</span>
          <span>{footer.copyright}</span>
        </div>
        <nav className={styles.footerLinks} aria-label="外部链接">
          {footer.links.map((link) => (
            <a href={link.href} target="_blank" rel="noreferrer" key={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
