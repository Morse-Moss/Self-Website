'use client';

import { useEffect, useState } from 'react';

import AdminExportDialog from './AdminExportDialog';
import AdminFilters from './AdminFilters';
import AdminLogin from './AdminLogin';
import AdminTurnDetailPanel from './AdminTurnDetail';
import AdminTurnList from './AdminTurnList';
import {
  buildAdminQuery,
  defaultAdminFilters,
  responseError,
  type AdminFilters as AdminFilterValues,
  type AdminTurnDetail,
  type AdminTurnList as AdminTurnListPayload,
  type AdminTurnSummary,
} from './admin-client';
import styles from './AdminConsole.module.css';

type AuthState = 'checking' | 'signed_out' | 'authorized' | 'unavailable';

const emptyList: AdminTurnListPayload = {
  items: [],
  total: 0,
  page: 1,
  limit: defaultAdminFilters.limit,
};

export default function AdminConsole() {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [sessionRevision, setSessionRevision] = useState(0);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [bootError, setBootError] = useState('');
  const [draftFilters, setDraftFilters] = useState<AdminFilterValues>(defaultAdminFilters);
  const [filters, setFilters] = useState<AdminFilterValues>(defaultAdminFilters);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [list, setList] = useState<AdminTurnListPayload | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminTurnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState('');

  function resetPrivateState() {
    setExpiresAt(null);
    setList(null);
    setListError('');
    setSelectedId(null);
    setDetail(null);
    setDetailError('');
    setMobileDetailOpen(false);
    setExportOpen(false);
    setNotice('');
  }

  function requireLogin(message: string) {
    resetPrivateState();
    setLoginError(message || '管理会话已过期，请重新登录。');
    setAuthState('signed_out');
  }

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

  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) setFiltersOpen(false);
  }, []);

  useEffect(() => {
    if (authState !== 'authorized') return;
    const controller = new AbortController();
    setListLoading(true);
    setListError('');

    fetch(`/api/admin/turns?${buildAdminQuery(filters)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) requireLogin(message);
        else setListError(message);
        return;
      }
      const payload = await response.json() as AdminTurnListPayload;
      setList(payload);
      setSelectedId((current) => (
        current && payload.items.some((item) => item.id === current)
          ? current
          : payload.items[0]?.id ?? null
      ));
      if (payload.items.length === 0) {
        setDetail(null);
        setMobileDetailOpen(false);
      }
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setListError('无法加载对话记录，请检查连接后重试。');
    }).finally(() => {
      if (!controller.signal.aborted) setListLoading(false);
    });

    return () => controller.abort();
  }, [authState, filters]);

  useEffect(() => {
    if (authState !== 'authorized' || !selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');

    fetch(`/api/admin/turns/${selectedId}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) requireLogin(message);
        else setDetailError(message);
        return;
      }
      setDetail(await response.json() as AdminTurnDetail);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setDetailError('无法加载对话详情，请检查连接后重试。');
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false);
    });

    return () => controller.abort();
  }, [authState, selectedId]);

  async function login(password: string, totpCode: string) {
    setLoginBusy(true);
    setLoginError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password, totpCode }),
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
      resetPrivateState();
      setLoginError('');
      setAuthState('signed_out');
    }
  }

  function applyFilters(next: AdminFilterValues) {
    setListLoading(true);
    setFilters(next);
    setSelectedId(null);
    setDetail(null);
    setMobileDetailOpen(false);
    setNotice('');
  }

  function selectTurn(turn: AdminTurnSummary) {
    setSelectedId(turn.id);
    setMobileDetailOpen(true);
    setNotice('');
  }

  function retryDetail() {
    const currentId = selectedId;
    setSelectedId(null);
    window.requestAnimationFrame(() => setSelectedId(currentId));
  }

  function reflectSavedBadcase(badcase: boolean, adminNote: string | null) {
    setDetail((current) => current ? { ...current, badcase, adminNote } : current);
    setList((current) => current ? {
      ...current,
      items: current.items.map((item) => (
        item.id === selectedId ? { ...item, badcase, adminNote } : item
      )),
    } : current);
  }

  if (authState === 'checking') {
    return <main className={styles.bootState} role="status">正在确认管理权限...</main>;
  }

  if (authState === 'unavailable') {
    return (
      <main className={styles.bootState}>
        <p role="alert">{bootError || '管理服务暂时不可用。'}</p>
        <button
          className={styles.secondaryButton}
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
    <main className={styles.console} data-testid="admin-console">
      <header className={styles.topbar}>
        <div className={styles.consoleTitle}>
          <span className={styles.signal} aria-hidden="true" />
          <div>
            <p className={styles.kicker}>MORSE / PRIVATE</p>
            <h1>对话复盘台</h1>
          </div>
        </div>
        <div className={styles.sessionActions}>
          <span className={styles.sessionExpiry}>
            {expiresAt ? `会话有效至 ${new Date(expiresAt).toLocaleTimeString('zh-CN')}` : '管理会话'}
          </span>
          <button
            className={styles.secondaryButton}
            data-testid="admin-export-open"
            type="button"
            onClick={() => setExportOpen(true)}
          >
            导出
          </button>
          <button
            className={styles.quietButton}
            data-testid="admin-logout"
            type="button"
            onClick={() => void logout()}
          >
            退出
          </button>
        </div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      <AdminFilters
        draft={draftFilters}
        open={filtersOpen}
        disabled={listLoading}
        onDraftChange={setDraftFilters}
        onApply={applyFilters}
        onToggle={() => setFiltersOpen((open) => !open)}
      />

      <div className={styles.workspace}>
        {listError ? (
          <section className={styles.listPanel}>
            <div className={styles.listError}>
              <p role="alert">{listError}</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setFilters((current) => ({ ...current }))}
              >
                重新加载
              </button>
            </div>
          </section>
        ) : (
          <AdminTurnList
            list={list ?? emptyList}
            selectedId={selectedId}
            loading={listLoading || list === null}
            onSelect={selectTurn}
            onPageChange={(page) => applyFilters({ ...filters, page })}
          />
        )}

        <AdminTurnDetailPanel
          detail={detail}
          loading={detailLoading || Boolean(selectedId && !detail && !detailError)}
          error={detailError}
          mobileOpen={mobileDetailOpen}
          onBack={() => setMobileDetailOpen(false)}
          onRetry={retryDetail}
          onUnauthorized={requireLogin}
          onSaved={reflectSavedBadcase}
        />
      </div>

      <AdminExportDialog
        open={exportOpen}
        filters={filters}
        onClose={() => setExportOpen(false)}
        onUnauthorized={requireLogin}
        onComplete={setNotice}
      />
    </main>
  );
}
