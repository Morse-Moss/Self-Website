'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { responseError, type AdminResumeDashboard } from './admin-client';
import styles from './AdminResumePanel.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onUnauthorized: (message: string) => void;
  onComplete: (message: string) => void;
}

type Section = 'document' | 'invites' | 'events';

function formatTime(value: string | null): string {
  if (!value) return '未发生';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}

function formatBytes(value: number): string {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export default function AdminResumePanel({ open, onClose, onUnauthorized, onComplete }: Props) {
  const [section, setSection] = useState<Section>('document');
  const [dashboard, setDashboard] = useState<AdminResumeDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const [uploadPassword, setUploadPassword] = useState('');
  const [note, setNote] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [revokePassword, setRevokePassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const onUnauthorizedRef = useRef(onUnauthorized);

  useEffect(() => {
    onCloseRef.current = onClose;
    onUnauthorizedRef.current = onUnauthorized;
  }, [onClose, onUnauthorized]);

  useEffect(() => {
    if (!open) {
      setDashboard(null);
      setCreatedCode(null);
      setUploadPassword('');
      setInvitePassword('');
      setRevokePassword('');
      setRevokeId(null);
      setNote('');
      setBusy('');
      setError('');
      setSection('document');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch('/api/admin/resume', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const message = await responseError(response);
          if (response.status === 401) onUnauthorizedRef.current(message);
          else setError(message);
          return;
        }
        setDashboard(await response.json() as AdminResumeDashboard);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setError('无法加载简历管理数据，请检查连接后重试。');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);

  function closePanel() {
    if (busy) return;
    onCloseRef.current();
  }

  function backdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    closePanel();
  }

  function panelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
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

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !uploadPassword) { setError('请选择最终 PDF，并输入当前管理密码。'); return; }
    const form = new FormData();
    form.set('file', file);
    form.set('password', uploadPassword);
    setBusy('upload'); setError('');
    try {
      const response = await fetch('/api/admin/resume', { method: 'POST', credentials: 'same-origin', body: form });
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorized(message); else setError(message);
        return;
      }
      setUploadPassword('');
      if (fileRef.current) fileRef.current.value = '';
      setRevision((value) => value + 1);
      onComplete('简历 PDF 已更新。');
    } catch { setError('上传结果未确认，请重新加载当前 PDF 状态。'); }
    finally { setBusy(''); }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!note.trim() || !invitePassword) { setError('请填写熟人备注，并输入当前管理密码。'); return; }
    setBusy('invite'); setError(''); setCreatedCode(null);
    try {
      const response = await fetch('/api/admin/resume/invites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ trustedPersonNote: note, password: invitePassword }),
      });
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorized(message); else setError(message);
        return;
      }
      const payload = await response.json() as { invite: { code: string } };
      setCreatedCode(payload.invite.code);
      setInvitePassword(''); setNote(''); setRevision((value) => value + 1);
    } catch { setError('生成结果未确认，请重新加载访问码列表。'); }
    finally { setBusy(''); }
  }

  async function revoke(inviteId: string) {
    if (!revokePassword) { setError('请输入当前管理密码后再停用。'); return; }
    setBusy(inviteId); setError('');
    try {
      const response = await fetch(`/api/admin/resume/invites/${inviteId}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ password: revokePassword }),
      });
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorized(message); else setError(message);
        return;
      }
      setRevokeId(null); setRevokePassword(''); setRevision((value) => value + 1);
      onComplete('访问码已停用，关联简历会话已失效。');
    } catch { setError('停用失败，请检查连接后重试。'); }
    finally { setBusy(''); }
  }

  if (!open) return null;
  const tabs: Array<[Section, string]> = [['document', '当前 PDF'], ['invites', '访问码'], ['events', '近 30 天记录']];

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={backdropMouseDown}>
      <section
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-panel-title"
        onKeyDown={panelKeyDown}
      >
        <header className={styles.header}>
          <div><p>PRIVATE RESUME</p><h2 id="resume-panel-title">简历管理</h2></div>
          <button ref={closeRef} type="button" aria-label="关闭简历管理" disabled={Boolean(busy)} onClick={closePanel}>×</button>
        </header>
        <nav className={styles.tabs} aria-label="简历管理分区">
          {tabs.map(([value, label]) => <button key={value} type="button" aria-current={section === value} onClick={() => setSection(value)}>{label}</button>)}
        </nav>
        {error ? <div className={styles.error}><p role="alert">{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>重新加载</button></div> : null}
        <div className={styles.content}>
          {loading ? <p className={styles.state} role="status">正在加载简历管理数据...</p> : null}
          {!loading && dashboard && section === 'document' ? (
            <div className={styles.documentLayout}>
              <section className={styles.summary}>
                <h3>当前 PDF</h3>
                {dashboard.document ? <dl>
                  <div><dt>上传时间</dt><dd>{formatTime(dashboard.document.uploadedAt)}</dd></div>
                  <div><dt>文件大小</dt><dd>{formatBytes(dashboard.document.plaintextBytes)}</dd></div>
                  <div><dt>密文校验值</dt><dd className={styles.hash}>{dashboard.document.cipherSha256}</dd></div>
                </dl> : <p className={styles.state}>尚未上传简历 PDF</p>}
              </section>
              <form className={styles.form} onSubmit={upload}>
                <h3>上传新版本</h3>
                <label><span>最终 PDF</span><input ref={fileRef} type="file" accept="application/pdf,.pdf" required /></label>
                <label><span>当前管理密码</span><input type="password" autoComplete="current-password" value={uploadPassword} onChange={(event) => setUploadPassword(event.target.value)} required /></label>
                <button type="submit" disabled={busy === 'upload'}>{busy === 'upload' ? '正在上传...' : '上传新版本'}</button>
              </form>
            </div>
          ) : null}
          {!loading && dashboard && section === 'invites' ? (
            <div className={styles.inviteLayout}>
              <form className={styles.form} onSubmit={createInvite}>
                <h3>生成访问码</h3>
                <label><span>熟人备注</span><input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} required /></label>
                <label><span>当前管理密码</span><input type="password" autoComplete="current-password" value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} required /></label>
                <button type="submit" disabled={busy === 'invite' || Boolean(createdCode)}>生成访问码</button>
                {createdCode ? <div className={styles.code}><strong>一次性访问码</strong><input value={createdCode} readOnly onFocus={(event) => event.currentTarget.select()} /><p>关闭面板后无法再次查看。</p></div> : null}
              </form>
              <section className={styles.list}><h3>访问码</h3>
                {dashboard.invites.length === 0 ? <p className={styles.state}>还没有访问码</p> : <ul>{dashboard.invites.map((invite) => <li key={invite.id}>
                  <div><strong>{invite.trustedPersonNote}</strong><span>{invite.disabledAt ? '已停用' : invite.redeemedAt ? '已兑换' : '待兑换'}</span></div>
                  <small>有效期至 {formatTime(invite.expiresAt)}</small>
                  {invite.disabledAt ? null : revokeId === invite.id ? <div className={styles.revoke}>
                    <input aria-label="当前管理密码" type="password" placeholder="当前管理密码" value={revokePassword} onChange={(event) => setRevokePassword(event.target.value)} />
                    <button type="button" disabled={busy === invite.id} onClick={() => void revoke(invite.id)}>停用访问码</button>
                    <button type="button" onClick={() => { setRevokeId(null); setRevokePassword(''); }}>取消</button>
                  </div> : <button type="button" onClick={() => setRevokeId(invite.id)}>停用</button>}
                </li>)}</ul>}
              </section>
            </div>
          ) : null}
          {!loading && dashboard && section === 'events' ? <section className={styles.events}><h3>近 30 天记录</h3>
            {dashboard.events.length === 0 ? <p className={styles.state}>还没有访问记录</p> : <ul>{dashboard.events.map((event) => <li key={event.id}>
              <div><strong>{event.eventType}</strong><span>{formatTime(event.createdAt)}</span></div>
              <dl><div><dt>结果</dt><dd>{event.resultCode}</dd></div><div><dt>IP</dt><dd>{event.ip ?? '未归属'}</dd></div><div><dt>浏览器</dt><dd>{event.userAgent ?? '未记录'}</dd></div></dl>
            </li>)}</ul>}
          </section> : null}
        </div>
      </section>
    </div>
  );
}
