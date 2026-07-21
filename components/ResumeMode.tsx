'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import styles from './ResumeMode.module.css';

export interface ResumeModeConfig {
  toggleLabel: string;
  printLabel?: string;
}

type ResumeModeToggleProps = {
  config: ResumeModeConfig;
  inline?: boolean;
};

interface ResumeAccessPayload {
  enabled: boolean;
  authorized: boolean;
  documentAvailable: boolean;
  expiresAt: string | null;
}

export type ResumeAccessState =
  | { kind: 'closed' }
  | { kind: 'checking' }
  | { kind: 'locked'; message: string }
  | { kind: 'authorized'; expiresAt: string }
  | { kind: 'unavailable'; message: string };

const unavailableMessage = '简历暂不可用，请稍后再试。';

function isAccessPayload(value: unknown): value is ResumeAccessPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.enabled === 'boolean'
    && typeof payload.authorized === 'boolean'
    && typeof payload.documentAvailable === 'boolean'
    && (typeof payload.expiresAt === 'string' || payload.expiresAt === null);
}

async function parseAccessPayload(response: Response): Promise<ResumeAccessPayload | null> {
  const value = await response.json().catch(() => null) as unknown;
  return isAccessPayload(value) ? value : null;
}

function accessStateFromResponse(
  response: Response,
  payload: ResumeAccessPayload | null,
  lockedMessage = '',
): ResumeAccessState {
  if (!payload) return { kind: 'unavailable', message: unavailableMessage };
  if (!payload.enabled || !payload.documentAvailable) {
    return { kind: 'unavailable', message: '简历暂不可用。' };
  }
  if (response.status === 401) return { kind: 'locked', message: lockedMessage };
  if (!response.ok) return { kind: 'unavailable', message: unavailableMessage };
  return payload.authorized && payload.expiresAt
    ? { kind: 'authorized', expiresAt: payload.expiresAt }
    : { kind: 'locked', message: lockedMessage };
}

export async function readResumeAccess(signal?: AbortSignal): Promise<ResumeAccessState> {
  const response = await fetch('/api/resume/access', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  return accessStateFromResponse(response, await parseAccessPayload(response));
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '当前会话';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function ResumeModeToggle({ config, inline = false }: ResumeModeToggleProps) {
  const [state, setState] = useState<ResumeAccessState>({ kind: 'closed' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const open = state.kind !== 'closed';

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (state.kind !== 'checking') return;
    const controller = new AbortController();
    readResumeAccess(controller.signal)
      .then(setState)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ kind: 'unavailable', message: unavailableMessage });
      });
    return () => controller.abort();
  }, [state.kind]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
        closeRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy, open, state.kind]);

  function openDialog() {
    setCode('');
    setState({ kind: 'checking' });
  }

  function closeDialog() {
    if (busy) return;
    setCode('');
    setState({ kind: 'closed' });
  }

  function backdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    closeDialog();
  }

  function dialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/resume/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: normalizedCode }),
      });
      const next = accessStateFromResponse(
        response,
        await parseAccessPayload(response),
        '访问码无效或已失效，请检查后重试。',
      );
      setCode('');
      setState(next);
    } catch {
      setState({ kind: 'unavailable', message: unavailableMessage });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/resume/access', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      setState(response.ok
        ? { kind: 'locked', message: '' }
        : { kind: 'unavailable', message: unavailableMessage });
    } catch {
      setState({ kind: 'unavailable', message: unavailableMessage });
    } finally {
      setBusy(false);
    }
  }

  const dialog = open ? createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={backdropMouseDown}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-access-title"
        onKeyDown={dialogKeyDown}
      >
        <header className={styles.dialogHeader}>
          <div>
            <p>PRIVATE ACCESS</p>
            <h2 id="resume-access-title">简历访问</h2>
          </div>
          <button
            ref={closeRef}
            className={styles.closeButton}
            type="button"
            aria-label="关闭简历访问"
            disabled={busy}
            onClick={closeDialog}
          >
            ×
          </button>
        </header>

        <div className={styles.dialogBody}>
          {state.kind === 'checking' ? (
            <p className={styles.stateMessage} role="status">正在检查访问状态...</p>
          ) : null}

          {state.kind === 'locked' ? (
            <form className={styles.accessForm} onSubmit={redeem}>
              <div>
                <h3>输入访问码</h3>
                <p>此入口仅用于已收到邀请的访客。</p>
              </div>
              <label>
                <span>邀请访问码</span>
                <input
                  data-testid="resume-access-code"
                  value={code}
                  maxLength={128}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              {state.message ? <p className={styles.error} role="alert">{state.message}</p> : null}
              <button className={styles.primaryAction} type="submit" disabled={busy || !code.trim()}>
                {busy ? '正在验证...' : '查看简历'}
              </button>
            </form>
          ) : null}

          {state.kind === 'authorized' ? (
            <section className={styles.authorized} aria-labelledby="resume-ready-title">
              <div>
                <p className={styles.readyLabel}>ACCESS GRANTED</p>
                <h3 id="resume-ready-title">简历已解锁</h3>
                <p>访问有效至 {formatExpiry(state.expiresAt)}</p>
              </div>
              <div className={styles.actions}>
                <a className={styles.primaryAction} href="/api/resume/file" target="_blank" rel="noreferrer">
                  打开 PDF
                </a>
                <button type="button" disabled={busy} onClick={() => void logout()}>
                  {busy ? '正在退出...' : '退出简历模式'}
                </button>
              </div>
            </section>
          ) : null}

          {state.kind === 'unavailable' ? (
            <section className={styles.unavailable}>
              <h3>简历暂不可用</h3>
              <p role="alert">{state.message}</p>
              <button type="button" onClick={() => setState({ kind: 'checking' })}>重新检查</button>
            </section>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        className={`${styles.toggle} ${inline ? styles.inline : ''}`}
        data-testid="resume-access-open"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openDialog}
      >
        <span className={styles.signal} aria-hidden="true" />
        <span>{config.toggleLabel}</span>
      </button>
      {dialog}
    </>
  );
}

export function ResumePrintButton({ label }: { label?: string }) {
  return (
    <a className={styles.printLink} href="/api/resume/file" target="_blank" rel="noreferrer">
      {label ?? '打开 PDF'}
    </a>
  );
}
