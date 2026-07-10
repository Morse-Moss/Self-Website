'use client';

import { useEffect, useState } from 'react';
import styles from './ResumeMode.module.css';

export interface ResumeModeConfig {
  storageKey: string;
  bodyClass: string;
  toggleLabel: string;
  printLabel: string;
}

function applyResumeMode(active: boolean, bodyClass: string) {
  document.documentElement.classList.toggle(bodyClass, active);
  document.body.classList.toggle(bodyClass, active);
}

export function ResumeModeToggle({ config }: { config: ResumeModeConfig }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(config.storageKey) === 'true';
    setActive(saved);
    applyResumeMode(saved, config.bodyClass);
    if (saved) window.scrollTo({ top: 0, behavior: 'auto' });

    return () => {
      document.documentElement.classList.remove(config.bodyClass);
      document.body.classList.remove(config.bodyClass);
    };
  }, [config.bodyClass, config.storageKey]);

  function toggle() {
    const next = !active;
    setActive(next);
    applyResumeMode(next, config.bodyClass);
    window.localStorage.setItem(config.storageKey, String(next));
    if (next) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return (
    <button
      className={styles.toggle}
      type="button"
      aria-pressed={active}
      onClick={toggle}
    >
      <span className={styles.signal} aria-hidden="true" />
      <span>{config.toggleLabel}</span>
    </button>
  );
}

export function ResumePrintButton({ label }: { label: string }) {
  return (
    <button className={styles.printButton} type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
