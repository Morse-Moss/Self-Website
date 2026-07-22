'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './AdminApiConsole.module.css';

export type ReauthKind = 'discover' | 'test' | 'activate' | 'delete' | 'save';

interface Props {
  busy: boolean;
  confirmationName?: string;
  error: string;
  kind: ReauthKind;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: (password: string, confirmationName: string) => void;
}

export default function AdminReauthDialog({
  busy,
  confirmationName = '',
  error,
  kind,
  open,
  title,
  onCancel,
  onConfirm,
}: Props) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmation('');
    window.requestAnimationFrame(() => passwordRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;
  const needsConfirmation = kind === 'delete';
  const networkCost = kind === 'discover' || kind === 'test';
  const valid = password.length > 0 && (!needsConfirmation || confirmation === confirmationName);

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section
        className={styles.dialog}
        data-testid="admin-reauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-reauth-title"
        data-reauth-kind={kind}
      >
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.eyebrow}>PASSWORD RECHECK</p>
            <h2 id="admin-reauth-title">{title}</h2>
          </div>
          <button type="button" className={styles.iconButton} aria-label="关闭" title="关闭" onClick={onCancel}>
            ×
          </button>
        </header>
        {networkCost ? (
          <p className={styles.costWarning}>此操作会连接中转，可能产生极少 API 费用。</p>
        ) : null}
        {kind === 'activate' ? (
          <p className={styles.dialogCopy}>激活后，新对话将立即使用这套路由；进行中的回答不受影响。</p>
        ) : null}
        {needsConfirmation ? (
          <label className={styles.field}>
            输入“{confirmationName}”确认删除
            <input
              name="confirmationName"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}
        <label className={styles.field}>
          管理密码
          <input
            ref={passwordRef}
            type="password"
            name="adminPassword"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className={styles.errorText} role="alert">{error}</p> : null}
        <footer className={styles.dialogActions}>
          <button type="button" className={styles.quietButton} disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            data-testid="admin-reauth-confirm"
            className={needsConfirmation ? styles.dangerButton : styles.primaryButton}
            disabled={busy || !valid}
            onClick={() => onConfirm(password, confirmation)}
          >
            {busy ? '处理中...' : needsConfirmation ? '确认删除' : '确认继续'}
          </button>
        </footer>
      </section>
    </div>
  );
}
