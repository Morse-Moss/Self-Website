import ScrollEffects from '@/components/ScrollEffects';
import AmbientBackground from '@/components/site/AmbientBackground';
import SiteFooter from '@/components/site/SiteFooter';
import SiteHeader from '@/components/site/SiteHeader';
import shellStyles from '@/components/site/SiteShell.module.css';
import { siteContent } from '@/lib/site-content';

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AmbientBackground />
      <ScrollEffects />
      <div className={shellStyles.standardContent} data-standard-content>
        <SiteHeader site={siteContent.site} />
        {children}
        <SiteFooter footer={siteContent.site.footer} />
      </div>
    </>
  );
}
