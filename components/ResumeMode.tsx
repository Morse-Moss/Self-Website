'use client';

import { useEffect, useState } from 'react';
import styles from './ResumeMode.module.css';

export interface ResumeModeConfig {
  storageKey: string;
  bodyClass: string;
  toggleLabel: string;
  printLabel: string;
}

type ResumeModeToggleProps = {
  config: ResumeModeConfig;
  inline?: boolean;
};

const RESUME_MODE_CHANGE_EVENT = 'morse-resume-mode:change';

function applyResumeMode(active: boolean, bodyClass: string) {
  document.documentElement.classList.toggle(bodyClass, active);
  document.body.classList.toggle(bodyClass, active);
}

export function ResumeModeToggle({ config, inline = false }: ResumeModeToggleProps) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    function syncFromStorage() {
      const saved = window.localStorage.getItem(config.storageKey) === 'true';
      setActive(saved);
      applyResumeMode(saved, config.bodyClass);
      if (saved) window.scrollTo({ top: 0, behavior: 'auto' });
    }

    syncFromStorage();
    window.addEventListener(RESUME_MODE_CHANGE_EVENT, syncFromStorage);

    return () => {
      window.removeEventListener(RESUME_MODE_CHANGE_EVENT, syncFromStorage);
      document.documentElement.classList.remove(config.bodyClass);
      document.body.classList.remove(config.bodyClass);
    };
  }, [config.bodyClass, config.storageKey]);

  function toggle() {
    const next = !active;
    setActive(next);
    applyResumeMode(next, config.bodyClass);
    window.localStorage.setItem(config.storageKey, String(next));
    window.dispatchEvent(new Event(RESUME_MODE_CHANGE_EVENT));
    if (next) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return (
    <button
      className={`${styles.toggle} ${inline ? styles.inline : ''}`}
      type="button"
      aria-pressed={active}
      onClick={toggle}
    >
      <span className={styles.signal} aria-hidden="true" />
      <span>{config.toggleLabel}</span>
    </button>
  );
}

export function ResumeModeExitButton({ config }: { config: ResumeModeConfig }) {
  function exitResumeMode() {
    applyResumeMode(false, config.bodyClass);
    window.localStorage.setItem(config.storageKey, 'false');
    window.dispatchEvent(new Event(RESUME_MODE_CHANGE_EVENT));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  return (
    <button className={styles.exitButton} type="button" onClick={exitResumeMode}>
      退出简历模式
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
