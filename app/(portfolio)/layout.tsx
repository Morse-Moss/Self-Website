import Script from 'next/script';

import ScrollEffects from '@/components/ScrollEffects';
import AmbientBackground from '@/components/site/AmbientBackground';
import ResumeSheet from '@/components/site/ResumeSheet';
import SiteFooter from '@/components/site/SiteFooter';
import SiteHeader from '@/components/site/SiteHeader';
import shellStyles from '@/components/site/SiteShell.module.css';
import { siteContent } from '@/lib/site-content';

const resumeModeBootScript = `
(() => {
  try {
    const key = ${JSON.stringify(siteContent.site.resumeMode.storageKey)};
    const rootClass = ${JSON.stringify(siteContent.site.resumeMode.bodyClass)};
    if (window.localStorage && window.localStorage.getItem(key) === 'true') {
      document.documentElement.classList.add(rootClass);
    }
  } catch (_) {}
})();
`;

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        id="resume-mode-boot"
        strategy="beforeInteractive"
        dangerouslySetInnerHTML={{ __html: resumeModeBootScript }}
      />
      <AmbientBackground />
      <ScrollEffects />
      <div className={shellStyles.standardContent} data-standard-content>
        <SiteHeader site={siteContent.site} />
        {children}
        <SiteFooter footer={siteContent.site.footer} />
      </div>
      <ResumeSheet
        printLabel={siteContent.site.resumeMode.printLabel}
        resumeMode={siteContent.site.resumeMode}
        profile={siteContent.profile}
        projects={siteContent.projects}
      />
    </>
  );
}
