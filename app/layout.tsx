import type { Metadata } from "next";
import Script from "next/script";
import SiteShell from "@/components/site/SiteShell";
import { siteContent } from "@/lib/site-content";
import "./globals.css";

export const metadata: Metadata = {
  title: siteContent.site.name,
  description: siteContent.site.description,
};

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script
          id="resume-mode-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: resumeModeBootScript }}
        />
      </head>
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
