'use client';

import { useEffect, useState } from 'react';

import AdminExportDialog from './AdminExportDialog';
import AdminFilters from './AdminFilters';
import AdminInviteDialog from './AdminInviteDialog';
import AdminResumePanel from './AdminResumePanel';
import { useAdminSession } from './AdminShell';
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

const emptyList: AdminTurnListPayload = {
  items: [],
  total: 0,
  page: 1,
  limit: defaultAdminFilters.limit,
};

export default function AdminConsole() {
  const { requireLogin } = useAdminSession();
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) setFiltersOpen(false);
  }, []);

  useEffect(() => {
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
  }, [filters, requireLogin]);

  useEffect(() => {
    if (!selectedId) {
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
  }, [requireLogin, selectedId]);

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

  return (
    <main className={styles.console} data-testid="admin-console">
      <header className={styles.topbar}>
        <div className={styles.consoleTitle}>
          <div>
            <p className={styles.kicker}>CONVERSATION REVIEW</p>
            <h1>对话复盘台</h1>
          </div>
        </div>
        <div className={styles.sessionActions}>
          <button
            className={styles.secondaryButton}
            data-testid="admin-resume-open"
            type="button"
            onClick={() => setResumeOpen(true)}
          >
            简历管理
          </button>
          <button
            className={styles.secondaryButton}
            data-testid="admin-invites-open"
            type="button"
            onClick={() => setInviteOpen(true)}
          >
            邀请码
          </button>
          <button
            className={styles.secondaryButton}
            data-testid="admin-export-open"
            type="button"
            onClick={() => setExportOpen(true)}
          >
            导出
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

      <AdminInviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onUnauthorized={requireLogin}
        onComplete={setNotice}
      />

      <AdminResumePanel
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        onUnauthorized={requireLogin}
        onComplete={setNotice}
      />

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
