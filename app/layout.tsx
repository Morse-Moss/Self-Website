import type { Metadata } from 'next';

import { siteContent } from '@/lib/site-content';

import './globals.css';

export const metadata: Metadata = {
  title: siteContent.site.name,
  description: siteContent.site.description,
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
