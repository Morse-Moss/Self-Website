import type { Metadata } from 'next';

import styles from '@/components/admin/AdminConsole.module.css';

export const metadata: Metadata = {
  title: '对话复盘台 | Morse',
  description: 'Morse 的私有对话分析与复盘工作台。',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={styles.adminShell} data-admin-shell>{children}</div>;
}
