'use client';

import {
  type AdminTurnList as AdminTurnListPayload,
  type AdminTurnSummary,
  type AdminTurnStatus,
  type AdminWorkflow,
} from './admin-client';
import styles from './AdminConsole.module.css';

const workflowLabels: Record<AdminWorkflow, string> = {
  chat: '自由对话',
  jd_match: 'JD 匹配',
  diagnosis: '需求初诊',
};

const statusLabels: Record<AdminTurnStatus, string> = {
  running: '处理中',
  completed: '已完成',
  stopped: '已停止',
  failed: '失败',
};

interface AdminTurnListProps {
  list: AdminTurnListPayload;
  selectedId: string | null;
  loading: boolean;
  onSelect: (turn: AdminTurnSummary) => void;
  onPageChange: (page: number) => void;
}

export default function AdminTurnList({
  list,
  selectedId,
  loading,
  onSelect,
  onPageChange,
}: AdminTurnListProps) {
  const pageCount = Math.max(1, Math.ceil(list.total / list.limit));

  return (
    <section className={styles.listPanel} aria-labelledby="admin-list-title" aria-busy={loading}>
      <header className={styles.panelHeading}>
        <div>
          <p className={styles.kicker}>INTERACTIONS</p>
          <h2 id="admin-list-title">对话记录</h2>
        </div>
        <span className={styles.resultCount}>共 {list.total} 条</span>
      </header>

      {loading ? <p className={styles.inlineStatus} role="status">正在加载对话记录...</p> : null}
      {list.items.length === 0 && !loading ? (
        <div className={styles.emptyState}>
          <p>没有符合当前筛选条件的记录。</p>
          <span>调整时间、流程或状态后重新筛选。</span>
        </div>
      ) : (
        <ol className={styles.turnList} aria-label="对话记录" data-testid="admin-turn-list">
          {list.items.map((turn) => {
            const selected = turn.id === selectedId;
            return (
              <li key={turn.id}>
                <button
                  className={styles.turnRow}
                  type="button"
                  data-testid="admin-turn-row"
                  data-turn-id={turn.id}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(turn)}
                >
                  <span className={styles.rowMeta}>
                    <span className={styles.workflow}>{workflowLabels[turn.workflow]}</span>
                    <span className={styles.status} data-status={turn.status}>{statusLabels[turn.status]}</span>
                    <span
                      className={styles.inviteLabel}
                      data-testid="admin-turn-invite-label"
                      title={turn.inviteLabel ?? '邀请对象未记录'}
                    >
                      {turn.inviteLabel ?? '邀请对象未记录'}
                    </span>
                    {turn.usedSearch ? <span className={styles.searchFlag}>联网</span> : null}
                    {turn.badcase ? <span className={styles.badcaseFlag}>BADCASE</span> : null}
                  </span>
                  <strong className={styles.question}>{turn.question}</strong>
                  <span className={styles.rowFooter}>
                    <time dateTime={turn.createdAt}>{new Date(turn.createdAt).toLocaleString('zh-CN')}</time>
                    <span>{turn.latencyMs === null ? '延迟未知' : `${turn.latencyMs.toLocaleString('zh-CN')} ms`}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <footer className={styles.pagination} aria-label="分页">
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading || list.page <= 1}
          onClick={() => onPageChange(list.page - 1)}
        >
          上一页
        </button>
        <span>第 {list.page} / {pageCount} 页</span>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading || list.page >= pageCount}
          onClick={() => onPageChange(list.page + 1)}
        >
          下一页
        </button>
      </footer>
    </section>
  );
}
