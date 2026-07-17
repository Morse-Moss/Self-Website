'use client';

import { type FormEvent, useState } from 'react';

import styles from './AdminConsole.module.css';

interface AdminLoginProps {
  busy: boolean;
  error: string;
  onSubmit: (password: string, totpCode: string) => Promise<void>;
}

export default function AdminLogin({ busy, error, onSubmit }: AdminLoginProps) {
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !password || !/^\d{6}$/u.test(totpCode)) return;
    void onSubmit(password, totpCode);
  }

  return (
    <main className={styles.loginStage}>
      <section className={styles.loginPanel} aria-labelledby="admin-login-title">
        <div className={styles.loginHeading}>
          <span className={styles.signal} aria-hidden="true" />
          <div>
            <p className={styles.kicker}>PRIVATE CONTROL</p>
            <h1 id="admin-login-title">对话复盘台</h1>
          </div>
        </div>
        <p className={styles.loginCopy}>仅用于检查近 10 天对话、标记 badcase 与导出分析数据。</p>

        <form className={styles.loginForm} data-testid="admin-login-form" onSubmit={submit}>
          <label className={styles.field}>
            <span>管理密码</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              maxLength={512}
              disabled={busy}
              required
              autoFocus
            />
          </label>
          <label className={styles.field}>
            <span>动态验证码</span>
            <input
              name="totpCode"
              type="text"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              disabled={busy}
              required
            />
          </label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} type="submit" disabled={busy || !password || totpCode.length !== 6}>
            {busy ? '正在验证...' : '进入复盘台'}
          </button>
        </form>
      </section>
    </main>
  );
}
