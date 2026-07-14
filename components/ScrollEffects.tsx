'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export default function ScrollEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const revealNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const morseNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-morse-pulse]'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      for (const node of revealNodes) node.dataset.revealed = 'true';
      for (const node of morseNodes) node.dataset.morseReady = 'true';
      return undefined;
    }

    gsap.registerPlugin(ScrollTrigger);

    const ctx = gsap.context(() => {
      for (const node of revealNodes) {
        gsap.fromTo(
          node,
          { autoAlpha: 0, y: window.innerWidth <= 760 ? 12 : 24 },
          {
            autoAlpha: 1,
            y: 0,
            duration: window.innerWidth <= 760 ? 0.42 : 0.72,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: node,
              start: 'top 84%',
              once: true,
              onEnter: () => {
                node.dataset.revealed = 'true';
              },
            },
          },
        );
      }

      for (const group of morseNodes) {
        const ticks = Array.from(group.querySelectorAll<HTMLElement>('[data-morse-tick]'));
        gsap.fromTo(
          ticks,
          { scaleX: 0.18, autoAlpha: 0.22 },
          {
            scaleX: 1,
            autoAlpha: 1,
            duration: 0.18,
            ease: 'steps(2)',
            stagger: { each: 0.07, from: 'start' },
            scrollTrigger: {
              trigger: group,
              start: 'top 88%',
              once: true,
              onEnter: () => {
                group.dataset.morseReady = 'true';
              },
            },
          },
        );
      }
    });

    return () => ctx.revert();
  }, [pathname]);

  return null;
}
