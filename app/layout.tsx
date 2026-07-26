import type { Metadata } from 'next';

import { siteContent, siteUrl } from '@/lib/site-content';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteContent.site.name,
  description: siteContent.site.description,
  openGraph: {
    title: siteContent.site.name,
    description: siteContent.site.description,
    url: siteUrl,
    siteName: siteContent.site.name,
    locale: 'zh_CN',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: siteContent.site.name,
    description: siteContent.site.description,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
