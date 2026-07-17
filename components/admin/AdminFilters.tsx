'use client';

import { type FormEvent } from 'react';

import {
  defaultAdminFilters,
  type AdminFilters as AdminFilterValues,
  type AdminTurnStatus,
  type AdminWorkflow,
} from './admin-client';
import styles from './AdminConsole.module.css';

interface AdminFiltersProps {
  draft: AdminFilterValues;
  open: boolean;
  disabled: boolean;
  onDraftChange: (filters: AdminFilterValues) => void;
  onApply: (filters: AdminFilterValues) => void;
  onToggle: () => void;
}

export default function AdminFilters({
  draft,
  open,
  disabled,
  onDraftChange,
  onApply,
  onToggle,
}: AdminFiltersProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply({ ...draft, page: 1 });
  }

  function reset() {
    onDraftChange(defaultAdminFilters);
    onApply(defaultAdminFilters);
  }

  return (
    <section className={styles.filters} data-open={open ? 'true' : 'false'} aria-labelledby="admin-filter-title">
      <div className={styles.filterHeading}>
        <div>
          <p className={styles.kicker}>FILTER</p>
          <h2 id="admin-filter-title">对话筛选</h2>
        </div>
        <button
          className={styles.filterToggle}
          type="button"
          aria-expanded={open}
          aria-controls="admin-filter-form"
          onClick={onToggle}
        >
          {open ? '收起筛选' : '展开筛选'}
        </button>
      </div>

      <form
        id="admin-filter-form"
        className={styles.filterForm}
        data-testid="admin-filter-form"
        onSubmit={submit}
      >
        <fieldset className={styles.timeGroup}>
          <legend>时间范围</legend>
          <label className={styles.field}>
            <span>开始时间</span>
            <input
              name="from"
              type="datetime-local"
              value={draft.from}
              onChange={(event) => onDraftChange({ ...draft, from: event.target.value })}
              disabled={disabled}
            />
          </label>
          <label className={styles.field}>
            <span>结束时间</span>
            <input
              name="to"
              type="datetime-local"
              value={draft.to}
              onChange={(event) => onDraftChange({ ...draft, to: event.target.value })}
              disabled={disabled}
            />
          </label>
        </fieldset>

        <label className={styles.field}>
          <span>流程</span>
          <select
            name="workflow"
            value={draft.workflow}
            onChange={(event) => onDraftChange({
              ...draft,
              workflow: event.target.value as '' | AdminWorkflow,
            })}
            disabled={disabled}
          >
            <option value="">全部流程</option>
            <option value="chat">自由对话</option>
            <option value="jd_match">JD 匹配</option>
            <option value="diagnosis">需求初诊</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>结果状态</span>
          <select
            name="status"
            value={draft.status}
            onChange={(event) => onDraftChange({
              ...draft,
              status: event.target.value as '' | AdminTurnStatus,
            })}
            disabled={disabled}
          >
            <option value="">全部状态</option>
            <option value="completed">已完成</option>
            <option value="running">处理中</option>
            <option value="stopped">已停止</option>
            <option value="failed">失败</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>联网状态</span>
          <select
            name="usedSearch"
            value={draft.usedSearch}
            onChange={(event) => onDraftChange({
              ...draft,
              usedSearch: event.target.value as '' | 'true' | 'false',
            })}
            disabled={disabled}
          >
            <option value="">全部</option>
            <option value="true">已联网</option>
            <option value="false">未联网</option>
          </select>
        </label>

        <label className={styles.field}>
          <span>Badcase</span>
          <select
            name="badcase"
            value={draft.badcase}
            onChange={(event) => onDraftChange({
              ...draft,
              badcase: event.target.value as '' | 'true' | 'false',
            })}
            disabled={disabled}
          >
            <option value="">全部</option>
            <option value="true">已标记</option>
            <option value="false">未标记</option>
          </select>
        </label>

        <div className={styles.filterActions}>
          <button className={styles.secondaryButton} type="button" onClick={reset} disabled={disabled}>
            重置
          </button>
          <button className={styles.primaryButton} type="submit" disabled={disabled}>
            应用筛选
          </button>
        </div>
      </form>
    </section>
  );
}
