'use client';

import { type FormEvent, useEffect, useState } from 'react';

import {
  responseError,
  type AdminSource,
  type AdminTurnDetail,
} from './admin-client';
import styles from './AdminConsole.module.css';

const sourceKindLabels: Record<AdminSource['kind'], string> = {
  local: '站内',
  official: '官方',
  github: 'GitHub',
  web: '网页',
};

const diagnosisFieldLabels: Record<string, string> = {
  problem: '问题',
  goal: '目标',
  currentState: '当前状态',
  constraints: '约束',
  expectedTimeline: '期望时间',
};

interface AdminTurnDetailProps {
  detail: AdminTurnDetail | null;
  loading: boolean;
  error: string;
  mobileOpen: boolean;
  onBack: () => void;
  onRetry: () => void;
  onUnauthorized: (message: string) => void;
  onSaved: (badcase: boolean, adminNote: string | null) => void;
}

function printableJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2) ?? '';
    return serialized.length > 12_000 ? `${serialized.slice(0, 12_000)}\n...` : serialized;
  } catch {
    return '搜索结果无法显示。';
  }
}

export default function AdminTurnDetailPanel({
  detail,
  loading,
  error,
  mobileOpen,
  onBack,
  onRetry,
  onUnauthorized,
  onSaved,
}: AdminTurnDetailProps) {
  const [badcase, setBadcase] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setBadcase(detail?.badcase ?? false);
    setAdminNote(detail?.adminNote ?? '');
    setSaveError('');
  }, [detail?.id, detail?.badcase, detail?.adminNote]);

  useEffect(() => {
    setSaved(false);
  }, [detail?.id]);

  async function saveBadcase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || saving) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/turns/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ badcase, note: adminNote }),
      });
      if (!response.ok) {
        const message = await responseError(response);
        if (response.status === 401) onUnauthorized(message);
        else setSaveError(message);
        return;
      }
      const updated = await response.json() as { badcase: boolean; adminNote: string | null };
      setBadcase(updated.badcase);
      setAdminNote(updated.adminNote ?? '');
      setSaved(true);
      onSaved(updated.badcase, updated.adminNote);
    } catch {
      setSaveError('保存失败，请检查连接后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={styles.detailPanel}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
      data-testid="admin-turn-detail"
      aria-labelledby="admin-detail-title"
    >
      <header className={styles.detailHeader}>
        <button className={styles.mobileBack} data-testid="admin-detail-back" type="button" onClick={onBack}>
          ← 返回列表
        </button>
        <div>
          <p className={styles.kicker}>INSPECTOR</p>
          <h2 id="admin-detail-title">对话详情</h2>
        </div>
      </header>

      <div className={styles.detailScroll} data-testid="admin-turn-detail-scroll">
        {loading ? (
          <div className={styles.detailState} role="status">正在加载对话详情...</div>
        ) : error ? (
          <div className={styles.detailState}>
            <p role="alert">{error}</p>
            <button className={styles.secondaryButton} type="button" onClick={onRetry}>重新加载</button>
          </div>
        ) : !detail ? (
          <div className={styles.detailState}>从左侧选择一条记录开始复盘。</div>
        ) : (
          <>
            <section className={styles.detailSection} aria-labelledby="turn-content-title">
              <div className={styles.sectionHeading}>
                <h3 id="turn-content-title">本轮内容</h3>
                <span className={styles.status} data-status={detail.status}>{detail.status}</span>
              </div>
              <dl className={styles.contentPairs}>
                <div>
                  <dt>访客问题</dt>
                  <dd>{detail.question}</dd>
                </div>
                <div>
                  <dt>数字摩斯回答</dt>
                  <dd>{detail.answer ?? '本轮没有完成回答。'}</dd>
                </div>
              </dl>
              {detail.errorCode ? <p className={styles.errorCode}>错误代码：{detail.errorCode}</p> : null}
            </section>

            <section className={styles.detailSection} aria-labelledby="turn-metrics-title">
              <h3 id="turn-metrics-title">运行信息</h3>
              <dl className={styles.metrics}>
                <div><dt>邀请对象</dt><dd>{detail.inviteLabel ?? '未记录'}</dd></div>
                <div><dt>流程</dt><dd>{detail.workflow}</dd></div>
                <div><dt>访客意图</dt><dd>{detail.audienceIntent}</dd></div>
                <div><dt>创建时间</dt><dd>{new Date(detail.createdAt).toLocaleString('zh-CN')}</dd></div>
                <div><dt>完成时间</dt><dd>{detail.completedAt ? new Date(detail.completedAt).toLocaleString('zh-CN') : '未完成'}</dd></div>
                <div><dt>延迟</dt><dd>{detail.latencyMs === null ? '未返回' : `${detail.latencyMs.toLocaleString('zh-CN')} ms`}</dd></div>
                <div><dt>输入 Token</dt><dd>{detail.inputTokens?.toLocaleString('zh-CN') ?? '未返回'}</dd></div>
                <div><dt>输出 Token</dt><dd>{detail.outputTokens?.toLocaleString('zh-CN') ?? '未返回'}</dd></div>
                <div><dt>估算费用</dt><dd>{detail.estimatedCostUsd === null ? '未配置' : `$${detail.estimatedCostUsd.toFixed(6)}`}</dd></div>
                <div><dt>Provider</dt><dd>{detail.provider ?? '未返回'}</dd></div>
                <div><dt>模型</dt><dd>{detail.model ?? '未返回'}</dd></div>
              </dl>
            </section>

            <section className={styles.detailSection} aria-labelledby="turn-sources-title">
              <div className={styles.sectionHeading}>
                <h3 id="turn-sources-title">引用来源</h3>
                <span className={styles.resultCount}>{detail.knowledgeSources.length} 条</span>
              </div>
              {detail.knowledgeSources.length ? (
                <ul className={styles.sourceList}>
                  {detail.knowledgeSources.map((source) => (
                    <li key={`${source.kind}-${source.id}`}>
                      <a href={source.href} target="_blank" rel="noopener noreferrer">
                        <span>{sourceKindLabels[source.kind]}</span>
                        <strong>{source.title}</strong>
                        <small>{source.domain ?? source.href}</small>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : <p className={styles.mutedText}>本轮没有引用来源。</p>}
            </section>

            {detail.search ? (
              <section className={styles.detailSection} aria-labelledby="turn-search-title">
                <div className={styles.sectionHeading}>
                  <h3 id="turn-search-title">联网搜索</h3>
                  <span className={styles.status} data-status={detail.search.status}>{detail.search.status}</span>
                </div>
                <dl className={styles.contentPairs}>
                  <div><dt>搜索词</dt><dd>{detail.search.query}</dd></div>
                  <div><dt>路由原因</dt><dd>{detail.search.routeReason}</dd></div>
                </dl>
                {detail.search.errorCode ? <p className={styles.errorCode}>搜索错误：{detail.search.errorCode}</p> : null}
                <details className={styles.rawDetails}>
                  <summary>查看搜索摘要</summary>
                  <pre>{printableJson(detail.search.results)}</pre>
                </details>
              </section>
            ) : null}

            {detail.diagnosis ? (
              <section className={styles.detailSection} aria-labelledby="turn-diagnosis-title">
                <div className={styles.sectionHeading}>
                  <h3 id="turn-diagnosis-title">需求初诊</h3>
                  <span className={styles.status} data-status={detail.diagnosis.status}>{detail.diagnosis.status}</span>
                </div>
                <p className={styles.diagnosisSummary}>{detail.diagnosis.summary}</p>
                <dl className={styles.contentPairs}>
                  {Object.entries(detail.diagnosis.fields).map(([key, value]) => (
                    <div key={key}>
                      <dt>{diagnosisFieldLabels[key] ?? key}</dt>
                      <dd>{typeof value === 'string' ? value : printableJson(value)}</dd>
                    </div>
                  ))}
                </dl>
                <p className={styles.mutedText}>通知状态：{detail.diagnosis.notificationStatus}</p>
              </section>
            ) : null}

            <section className={styles.reviewSection} aria-labelledby="turn-review-title">
              <h3 id="turn-review-title">复盘标记</h3>
              <form className={styles.reviewForm} data-testid="admin-badcase-form" onSubmit={saveBadcase}>
                <label className={styles.checkboxField}>
                  <input
                    name="badcase"
                    type="checkbox"
                    checked={badcase}
                    onChange={(event) => {
                      setBadcase(event.target.checked);
                      setSaved(false);
                    }}
                  />
                  <span>标记为 badcase</span>
                </label>
                <label className={styles.field}>
                  <span>管理员备注</span>
                  <textarea
                    name="adminNote"
                    value={adminNote}
                    onChange={(event) => {
                      setAdminNote(event.target.value);
                      setSaved(false);
                    }}
                    maxLength={2_000}
                    rows={5}
                    placeholder="记录问题归因、修复方向或后续评测样本。"
                  />
                  <small>{adminNote.length.toLocaleString('zh-CN')} / 2,000</small>
                </label>
                {saveError ? <p className={styles.formError} role="alert">{saveError}</p> : null}
                {saved ? <p className={styles.formSuccess} role="status">复盘标记已保存。</p> : null}
                <button className={styles.primaryButton} type="submit" disabled={saving}>
                  {saving ? '正在保存...' : '保存标记'}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
