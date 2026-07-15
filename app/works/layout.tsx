import type { ReactNode } from 'react';

import MorseChat from '@/components/MorseChat';

export default function WorksLayout({ children }: { children: ReactNode }) {
  return <>{children}<MorseChat /></>;
}
