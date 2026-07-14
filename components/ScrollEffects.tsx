'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

function revealNode(node: HTMLElement) {
  if (node.hasAttribute('data-reveal')) node.dataset.revealed = 'true';
  if (node.hasAttribute('data-morse-pulse')) node.dataset.morseReady = 'true';
}

export default function ScrollEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const morseNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-morse-pulse]'));
    const observedNodes = Array.from(new Set([...revealNodes, ...morseNodes]));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      for (const node of observedNodes) revealNode(node);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        revealNode(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    for (const node of observedNodes) observer.observe(node);

    return () => {
      for (const node of observedNodes) observer.unobserve(node);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
