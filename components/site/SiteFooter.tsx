import type { SiteContent } from '@/lib/site-content';

import styles from './SiteShell.module.css';

export default function SiteFooter({ footer }: { footer: SiteContent['site']['footer'] }) {
  return (
    <footer className={styles.siteFooter} data-site-footer>
      <div className={styles.footerInner}>
        <span className={styles.footerMorse}>{footer.morse}</span>
        <span>{footer.statement}</span>
        <span>{footer.copyright}</span>
      </div>
    </footer>
  );
}
