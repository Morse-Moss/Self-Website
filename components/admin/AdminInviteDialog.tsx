'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  responseError,
  type AdminInvite,
  type AdminInviteList,
} from './admin-client';
import styles from './AdminInviteDialog.module.css';

interface AdminInviteDialogProps {
  open: boolean;
  onClose: () => void;
  onUnauthorized: (message: string) => void;
  onComplete: (message: string) => void;
}

type CopyState = 'idle' | 'copied' | 'failed';

const statusLabel: Record<AdminInvite['status'], string> = {
  active: '有效',
  expired: '已过期',
  exhausted: '已耗尽',
  inactive: '已停用',
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export default function AdminInviteDialog({
  open,
  onClose,
  onUnauthorized,
  onComplete,
}: AdminInviteDialogProps) {
  const [items, setItems] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [label, setLabel] = useState('HR interview');
  const [durationValue, setDurationValue] = useState('72');
  const [maxSessionsValue, setMaxSessionsValue] = useState('3');
  const [freshTotp, setFreshTotp] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  useEffect(() => {
    if (!open) {
      setCreatedCode(null);
      setCopyState('idle');
      setFormError('');
      setConfirmingId(null);
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => previousFocusRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    fetch('/api/admin/invites', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorizedRef.current(message);
        else setLoadError(message);
        return;
      }
      const payload = await response.json() as AdminInviteList;
      setItems(payload.items);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setLoadError('无法加载邀请码，请检查连接后重试。');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, loadRevision]);

  function closeDialog() {
    if (creating) return;
    setCreatedCode(null);
    setCopyState('idle');
    setFreshTotp('');
    setConfirmingId(null);
    onClose();
  }

  function backdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) closeDialog();
  }

  function dialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || createdCode) return;
    const durationHours = Number(durationValue);
    const maxSessions = Number(maxSessionsValue);
    setCreating(true);
    setFormError('');
    setCreatedCode(null);
    setCopyState('idle');
    try {
      const response = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          label,
          durationHours,
          maxSessions,
          totpCode: freshTotp
        }),
      });
      if (!response.ok) {
        const errorPayload = await response.clone().json().catch(() => ({})) as { error?: unknown };
        const message = await responseError(response);
        if (response.status === 401 && errorPayload.error === 'ADMIN_AUTH_REQUIRED') {
          onUnauthorizedRef.current(message);
        } else {
          setFormError(message);
        }
        return;
      }
      const payload = await response.json() as { invite: AdminInvite; code: string };
      setItems((current) => [payload.invite, ...current.filter((item) => item.id !== payload.invite.id)]);
      setCreatedCode(payload.code);
      setFreshTotp('');
      window.requestAnimationFrame(() => {
        codeInputRef.current?.focus();
        codeInputRef.current?.select();
      });
    } catch {
      setFormError('生成结果未确认。请重新加载列表；如果出现没有明文的新记录，请停用后重建。');
    } finally {
      setCreating(false);
    }
  }

  async function copyCode() {
    if (!createdCode) return;
    try {
      await navigator.clipboard.writeText(createdCode);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
      codeInputRef.current?.focus();
      codeInputRef.current?.select();
    }
  }

  async function deactivateInvite(inviteId: string) {
    if (deactivatingId) return;
    setDeactivatingId(inviteId);
    setLoadError('');
    try {
      const response = await fetch(`/api/admin/invites/${inviteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ active: false }),
      });
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorized(message);
        else setLoadError(message);
        return;
      }
      const updated = await response.json() as AdminInvite;
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setConfirmingId(null);
      onComplete(`已停用“${updated.label}”，新的访客无法再兑换。`);
    } catch {
      setLoadError('无法停用邀请码，请检查连接后重试。');
    } finally {
      setDeactivatingId(null);
    }
  }

  if (!open) return null;

  const creationLocked = creating || Boolean(createdCode);
  const createButtonLabel = creating
    ? '正在生成...'
    : createdCode ? '邀请码已生成' : '生成邀请码';

  return (
    <div className={styles.backdrop} onMouseDown={backdropClick}>
      <div
        ref={dialogRef}
        className={styles.inviteDialog}
        data-testid="admin-invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-invite-title"
        onKeyDown={dialogKeyDown}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>ACCESS CONTROL</p>
            <h2 id="admin-invite-title">邀请码管理</h2>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.closeButton}
            type="button"
            aria-label="关闭邀请码管理"
            title="关闭"
            disabled={creating}
            onClick={closeDialog}
          >
            ×
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.generator} aria-labelledby="admin-invite-create-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.step}>01 / CREATE</p>
                <h3 id="admin-invite-create-title">生成新邀请码</h3>
              </div>
              <span>默认 72 小时</span>
            </div>

            <form className={styles.form} data-testid="admin-invite-form" onSubmit={createInvite}>
              <label className={styles.field}>
                <span>名称</span>
                <input
                  name="inviteLabel"
                  value={label}
                  maxLength={80}
                  autoComplete="off"
                  required
                  disabled={creationLocked}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </label>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  <span>有效时长（小时）</span>
                  <input
                    name="durationHours"
                    type="number"
                    value={durationValue}
                    min={1}
                    max={720}
                    step={1}
                    required
                    disabled={creationLocked}
                    onChange={(event) => setDurationValue(event.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span>最大会话数</span>
                  <input
                    name="maxSessions"
                    type="number"
                    value={maxSessionsValue}
                    min={1}
                    max={100}
                    step={1}
                    required
                    disabled={creationLocked}
                    onChange={(event) => setMaxSessionsValue(event.target.value)}
                  />
                </label>
              </div>
              <label className={styles.field}>
                <span>新的动态验证码</span>
                <input
                  name="inviteTotpCode"
                  value={freshTotp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="6 位验证码"
                  required
                  disabled={creationLocked}
                  onChange={(event) => setFreshTotp(event.target.value.replace(/\D/gu, '').slice(0, 6))}
                />
              </label>
              {formError ? <p className={styles.error} role="alert">{formError}</p> : null}
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={creating || Boolean(createdCode)}
              >
                {createButtonLabel}
              </button>
            </form>

            {createdCode ? (
              <div className={styles.codeReveal} role="status">
                <div className={styles.codeHeading}>
                  <strong>一次性邀请码</strong>
                  <span>关闭后无法再次查看</span>
                </div>
                <input
                  ref={codeInputRef}
                  className={styles.codeInput}
                  data-testid="admin-invite-code"
                  value={createdCode}
                  aria-label="新邀请码"
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <div className={styles.codeActions}>
                  <button
                    className={styles.secondaryButton}
                    data-testid="admin-invite-copy"
                    type="button"
                    onClick={() => void copyCode()}
                  >
                    {copyState === 'copied' ? '已复制' : '复制'}
                  </button>
                  <span aria-live="polite">
                    {copyState === 'failed' ? '复制失败，请使用已选中的文本手动复制。' : ''}
                  </span>
                </div>
              </div>
            ) : null}
          </section>

          <section className={styles.listPane} aria-labelledby="admin-invite-list-title">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.step}>02 / MANAGE</p>
                <h3 id="admin-invite-list-title">现有邀请码</h3>
              </div>
              <span>{items.length} 条</span>
            </div>

            {loadError ? (
              <div className={styles.centerState}>
                <p role="alert">{loadError}</p>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => setLoadRevision((revision) => revision + 1)}
                >
                  重新加载
                </button>
              </div>
            ) : loading ? (
              <p className={styles.centerState} role="status">正在加载邀请码...</p>
            ) : items.length === 0 ? (
              <p className={styles.centerState}>还没有邀请码</p>
            ) : (
              <ul className={styles.inviteList} data-testid="admin-invite-list">
                {items.map((invite) => (
                  <li className={styles.inviteRow} key={invite.id} data-invite-id={invite.id}>
                    <div className={styles.inviteSummary}>
                      <div className={styles.inviteTitleLine}>
                        <strong>{invite.label}</strong>
                        <span className={styles.statusBadge} data-status={invite.status}>
                          {statusLabel[invite.status]}
                        </span>
                      </div>
                      <dl className={styles.inviteMeta}>
                        <div>
                          <dt>使用</dt>
                          <dd>{invite.sessionCount} / {invite.maxSessions}</dd>
                        </div>
                        <div>
                          <dt>有效期至</dt>
                          <dd>{formatTime(invite.expiresAt)}</dd>
                        </div>
                      </dl>
                    </div>
                    {invite.active ? (
                      confirmingId === invite.id ? (
                        <div className={styles.confirmation}>
                          <p>只阻止新兑换，已登录访客不受影响。</p>
                          <div>
                            <button
                              className={styles.quietButton}
                              type="button"
                              disabled={deactivatingId === invite.id}
                              onClick={() => setConfirmingId(null)}
                            >
                              取消
                            </button>
                            <button
                              className={styles.dangerButton}
                              data-testid="admin-invite-deactivate-confirm"
                              type="button"
                              disabled={deactivatingId === invite.id}
                              onClick={() => void deactivateInvite(invite.id)}
                            >
                              {deactivatingId === invite.id ? '正在停用...' : '确认停用'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className={styles.quietButton}
                          data-testid="admin-invite-deactivate"
                          type="button"
                          onClick={() => setConfirmingId(invite.id)}
                        >
                          停用
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
