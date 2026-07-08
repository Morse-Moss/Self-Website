import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "数字生命摩斯",
  description: "一个人 + 一套 AI 操作系统",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
