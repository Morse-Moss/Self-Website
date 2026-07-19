'use client';

import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from 'react';

import {
  exportFileName,
  normalizeAdminFilters,
  responseError,
  type AdminExportFormat,
  type AdminFilters,
} from './admin-client';
import styles from './AdminConsole.module.css';

interface AdminExportDialogProps {
  open: boolean;
  filters: AdminFilters;
  onClose: () => void;
  onUnauthorized: (message: string) => void;
  onComplete: (message: string) => void;
}

export default function AdminExportDialog({
  open,
  filters,
  onClose,
  onUnauthorized,
  onComplete,
}: AdminExportDialogProps) {
  const [format, setFormat] = useState<AdminExportFormat>('json');
  const [password, setPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const exportingRef = useRef(false);

  useEffect(() => {
    exportingRef.current = exporting;
  }, [exporting]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => passwordRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !exportingRef.current) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', closeOnEscape);
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (open) return;
    setPassword('');
    setError('');
    setExporting(false);
  }, [open]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !exporting) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exporting || !password) return;
    setExporting(true);
    setError('');
    const exportFilters = { ...normalizeAdminFilters(filters), page: 1 };
    try {
      const response = await fetch('/api/admin/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ format, password, filters: exportFilters }),
      });
      if (!response.ok) {
        const errorPayload = await response.clone().json().catch(() => ({})) as { error?: unknown };
        const message = await responseError(response);
        if (response.status === 401 && errorPayload.error === 'ADMIN_AUTH_REQUIRED') {
          onUnauthorized(message);
        }
        else setError(message);
        return;
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = exportFileName(response.headers.get('content-disposition'), format);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      onComplete(`${format.toUpperCase()} 导出已开始下载。`);
      onClose();
    } catch {
      setError('导出失败，请检查连接后重试。');
    } finally {
      setExporting(false);
    }
  }

  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} onMouseDown={closeFromBackdrop}>
      <section
        className={styles.exportDialog}
        role="dialog"
        data-testid="admin-export-dialog"
        aria-modal="true"
        aria-labelledby="admin-export-title"
      >
        <header className={styles.dialogHeader}>
          <div>
            <p className={styles.kicker}>SECURE EXPORT</p>
            <h2 id="admin-export-title">导出当前筛选结果</h2>
          </div>
          <button className={styles.iconButton} type="button" onClick={onClose} disabled={exporting} aria-label="关闭导出">
            ×
          </button>
        </header>

        <form className={styles.exportForm} data-testid="admin-export-form" onSubmit={submit}>
          <fieldset className={styles.formatPicker}>
            <legend>文件格式</legend>
            <label>
              <input
                type="radio"
                name="exportFormat"
                value="json"
                checked={format === 'json'}
                onChange={() => setFormat('json')}
                disabled={exporting}
              />
              <span>JSON</span>
            </label>
            <label>
              <input
                type="radio"
                name="exportFormat"
                value="csv"
                checked={format === 'csv'}
                onChange={() => setFormat('csv')}
                disabled={exporting}
              />
              <span>CSV</span>
            </label>
          </fieldset>

          <label className={styles.field}>
            <span>再次输入管理密码</span>
            <input
              ref={passwordRef}
              name="exportPassword"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={512}
              disabled={exporting}
              required
            />
          </label>

          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <div className={styles.dialogActions}>
            <button className={styles.secondaryButton} type="button" onClick={onClose} disabled={exporting}>取消</button>
            <button className={styles.primaryButton} type="submit" disabled={exporting || !password}>
              {exporting ? '正在导出...' : `导出 ${format.toUpperCase()}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
