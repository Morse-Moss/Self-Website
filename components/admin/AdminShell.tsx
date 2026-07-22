'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import AdminLogin from './AdminLogin';
import { responseError } from './admin-client';
import consoleStyles from './AdminConsole.module.css';
import styles from './AdminShell.module.css';

type AuthState = 'checking' | 'signed_out' | 'authorized' | 'unavailable';

interface AdminSessionContextValue {
  expiresAt: string | null;
  requireLogin: (message?: string) => void;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function useAdminSession(): AdminSessionContextValue {
  const value = useContext(AdminSessionContext);
  if (!value) throw new Error('useAdminSession must be used inside AdminShell');
  return value;
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [sessionRevision, setSessionRevision] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [bootError, setBootError] = useState('');

  const requireLogin = useCallback((message = '管理会话已过期，请重新登录。') => {
    setExpiresAt(null);
    setLoginError(message);
    setAuthState('signed_out');
  }, []);

  useEffect(() => {
    let active = true;
    setBootError('');
    fetch('/api/admin/session', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) {
          setAuthState('signed_out');
          return;
        }
        if (!response.ok) {
          setBootError(await responseError(response));
          setAuthState('unavailable');
          return;
        }
        const session = await response.json() as { authorized: boolean; expiresAt: string };
        if (!active) return;
        setExpiresAt(session.expiresAt);
        setAuthState(session.authorized ? 'authorized' : 'signed_out');
      })
      .catch(() => {
        if (!active) return;
        setBootError('无法连接管理服务，请确认本地服务与数据库已启动。');
        setAuthState('unavailable');
      });
    return () => { active = false; };
  }, [sessionRevision]);

  async function login(password: string) {
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setLoginError(await responseError(response));
        return;
      }
      const session = await response.json() as { ok: true; expiresAt: string };
      setExpiresAt(session.expiresAt);
      setAuthState('authorized');
    } catch {
      setLoginError('无法连接管理服务，请检查连接后重试。');
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/admin/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } finally {
      setExpiresAt(null);
      setLoginError('');
      setAuthState('signed_out');
    }
  }

  const sessionValue = useMemo(() => ({ expiresAt, requireLogin }), [expiresAt, requireLogin]);

  if (authState === 'checking') {
    return <main className={consoleStyles.bootState} role="status">正在确认管理权限...</main>;
  }

  if (authState === 'unavailable') {
    return (
      <main className={consoleStyles.bootState}>
        <p role="alert">{bootError || '管理服务暂时不可用。'}</p>
        <button
          className={consoleStyles.secondaryButton}
          type="button"
          onClick={() => {
            setAuthState('checking');
            setSessionRevision((revision) => revision + 1);
          }}
        >
          重新加载
        </button>
      </main>
    );
  }

  if (authState === 'signed_out') {
    return <AdminLogin busy={loginBusy} error={loginError} onSubmit={login} />;
  }

  return (
    <AdminSessionContext.Provider value={sessionValue}>
      <div className={styles.adminShell} data-admin-shell>
        <header className={styles.shellHeader}>
          <div className={styles.brand}>
            <span className={styles.signal} aria-hidden="true" />
            <div>
              <p>MORSE / PRIVATE</p>
              <strong>管理工作台</strong>
            </div>
          </div>
          <nav className={styles.tabs} aria-label="后台导航">
            <Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined}>
              对话复盘
            </Link>
            <Link href="/admin/api" aria-current={pathname === '/admin/api' ? 'page' : undefined}>
              API 配置
            </Link>
          </nav>
          <div className={styles.session}>
            <span>
              {expiresAt ? `有效至 ${new Date(expiresAt).toLocaleTimeString('zh-CN')}` : '管理会话'}
            </span>
            <button type="button" data-testid="admin-logout" onClick={() => void logout()}>
              退出
            </button>
          </div>
        </header>
        <div className={styles.shellBody}>{children}</div>
      </div>
    </AdminSessionContext.Provider>
  );
}
