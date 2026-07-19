'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import MorseSignalCanvas from './MorseSignalCanvas';

const WarpTunnelCanvas = dynamic(() => import('./WarpTunnelCanvas'), {
  ssr: false,
});

export default function AmbientBackground() {
  const pathname = usePathname();

  return pathname === '/' ? <WarpTunnelCanvas /> : <MorseSignalCanvas />;
}
