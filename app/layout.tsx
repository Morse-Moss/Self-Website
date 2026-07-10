import type { Metadata } from "next";
import Script from "next/script";
import s3Content from "@/content/s3-content.json";
import "./globals.css";

export const metadata: Metadata = {
  title: "数字生命摩斯",
  description: "一个人 + 一套 AI 操作系统",
};

const resumeModeBootScript = `
(() => {
  try {
    const key = ${JSON.stringify(s3Content.resumeMode.storageKey)};
    const rootClass = ${JSON.stringify(s3Content.resumeMode.bodyClass)};
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
      <body>
        <Script
          id="resume-mode-boot"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: resumeModeBootScript }}
        />
        {children}
      </body>
    </html>
  );
}
