'use client';

import type {
  ProviderCatalog,
  ProviderConnection,
  ProviderEvent,
  ProviderModel,
  ProviderRuntimeSummary,
} from './admin-api-client';
import styles from './AdminApiConsole.module.css';

interface Props {
  catalog: ProviderCatalog;
  events: ProviderEvent[];
  includeDeleted: boolean;
  mobileOpen: boolean;
  runtime: ProviderRuntimeSummary;
  selectedId: string | null;
  onAddModel: (connection: ProviderConnection) => void;
  onBack: () => void;
  onCreate: () => void;
  onDeleteConnection: (connection: ProviderConnection) => void;
  onDeleteModel: (model: ProviderModel) => void;
  onDiscover: (connection: ProviderConnection) => void;
  onEditConnection: (connection: ProviderConnection) => void;
  onEditModel: (connection: ProviderConnection, model: ProviderModel) => void;
  onSelect: (connection: ProviderConnection) => void;
  onTest: (model: ProviderModel) => void;
  onToggleDeleted: (value: boolean) => void;
}

function domain(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function lastTest(events: ProviderEvent[], digest: string): ProviderEvent | null {
  return events.find((event) => event.configDigest === digest
    && ['provider_test', 'environment_test'].includes(event.eventType)) ?? null;
}

function testLabel(events: ProviderEvent[], digest: string): string {
  const event = lastTest(events, digest);
  if (!event) return '未测试';
  if (event.status !== 'succeeded') return '测试失败';
  return `${new Date(event.createdAt).toLocaleString('zh-CN')} · ${event.latencyMs ?? '-'}ms`;
}

export default function AdminProviderLibrary({
  catalog,
  events,
  includeDeleted,
  mobileOpen,
  runtime,
  selectedId,
  onAddModel,
  onBack,
  onCreate,
  onDeleteConnection,
  onDeleteModel,
  onDiscover,
  onEditConnection,
  onEditModel,
  onSelect,
  onTest,
  onToggleDeleted,
}: Props) {
  const selected = catalog.items.find((connection) => connection.seriesId === selectedId) ?? null;
  const activeDigests = new Set(runtime.targets.map((target) => target.configDigest));

  return (
    <section className={styles.library} aria-labelledby="provider-library-title">
      <header className={styles.libraryToolbar}>
        <div>
          <p className={styles.eyebrow}>PROVIDER LIBRARY</p>
          <h2 id="provider-library-title">中转配置库</h2>
        </div>
        <div className={styles.libraryActions}>
          <label className={styles.checkField}>
            <input
              type="checkbox"
              name="includeDeleted"
              checked={includeDeleted}
              onChange={(event) => onToggleDeleted(event.target.checked)}
            />
            显示已删除
          </label>
          <button type="button" data-testid="provider-create" className={styles.primaryButton} onClick={onCreate}>新增中转</button>
        </div>
      </header>

      <div className={styles.libraryWorkspace}>
        <nav className={styles.connectionList} aria-label="中转列表">
          {catalog.items.length === 0 ? (
            <div className={styles.emptyState} data-state="empty">
              <strong>{includeDeleted ? '没有匹配的配置' : '还没有数据库中转'}</strong>
              <span>新增中转后可配置模型、测试并加入全站路由。</span>
            </div>
          ) : catalog.items.map((connection) => {
            const active = connection.models.some((model) => activeDigests.has(model.configDigest));
            const latestTest = connection.models
              .map((model) => lastTest(events, model.configDigest))
              .find(Boolean);
            return (
              <button
                key={connection.seriesId}
                type="button"
                className={styles.connectionRow}
                aria-current={connection.seriesId === selectedId ? 'true' : undefined}
                onClick={() => onSelect(connection)}
              >
                <span className={styles.connectionMain}>
                  <strong>{connection.displayName}</strong>
                  <small>{domain(connection.baseUrl)}</small>
                </span>
                <span className={styles.connectionMeta}>
                  <small>{connection.models.length} 个模型</small>
                  <small>{connection.deletedAt ? '已删除' : connection.archivedAt ? '已归档' : active ? '使用中' : '待命'}</small>
                  <small>{latestTest?.status === 'succeeded' ? '最近测试通过' : latestTest ? '最近测试失败' : '未测试'}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <article className={styles.inspector} data-mobile-open={mobileOpen ? 'true' : 'false'}>
          <button type="button" className={styles.mobileBack} onClick={onBack}>← 返回列表</button>
          {!selected ? (
            <div className={styles.emptyState}>
              <strong>选择一个中转</strong>
              <span>查看模型、版本、测试状态和安全操作。</span>
            </div>
          ) : (
            <>
              <header className={styles.inspectorHeader}>
                <div>
                  <p className={styles.eyebrow}>CONNECTION / V{selected.version}</p>
                  <h2>{selected.displayName}</h2>
                  <p className={styles.longText}>{selected.baseUrl}</p>
                </div>
                <span className={selected.hasApiKey ? styles.goodStatus : styles.warnStatus}>
                  {selected.hasApiKey ? 'Key 已加密保存' : 'Key 不可用'}
                </span>
              </header>

              <div className={styles.inspectorActions}>
                <button type="button" className={styles.secondaryButton} disabled={Boolean(selected.deletedAt)} onClick={() => onEditConnection(selected)}>编辑</button>
                <button type="button" data-testid="provider-discover" className={styles.secondaryButton} disabled={Boolean(selected.deletedAt)} onClick={() => onDiscover(selected)}>获取模型列表</button>
                <button type="button" className={styles.secondaryButton} disabled={Boolean(selected.deletedAt)} onClick={() => onAddModel(selected)}>新增模型</button>
                <button type="button" className={styles.dangerQuietButton} disabled={Boolean(selected.deletedAt)} onClick={() => onDeleteConnection(selected)}>删除中转</button>
              </div>

              <section className={styles.modelSection} aria-labelledby="provider-models-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>MODEL PRESETS</p>
                    <h3 id="provider-models-title">模型预设</h3>
                  </div>
                </div>
                {selected.models.length === 0 ? (
                  <p className={styles.emptyState}>该连接当前没有可显示的模型。</p>
                ) : (
                  <div className={styles.modelList}>
                    {selected.models.map((model) => {
                      const active = activeDigests.has(model.configDigest);
                      return (
                        <article key={model.seriesId} className={styles.modelRow}>
                          <div className={styles.modelIdentity}>
                            <span>
                              <strong>{model.displayName}</strong>
                              <small className={styles.longText}>{model.modelId}</small>
                            </span>
                            <span className={styles.protocolBadge}>{model.protocol === 'responses' ? 'Responses' : 'Chat Completions'}</span>
                          </div>
                          <dl className={styles.modelFacts}>
                            <div><dt>版本</dt><dd>v{model.version}</dd></div>
                            <div><dt>最大输出</dt><dd>{model.maxOutputTokens}</dd></div>
                            <div><dt>推理</dt><dd>{model.reasoningEffort ?? '默认'}</dd></div>
                            <div><dt>状态</dt><dd>{model.deletedAt ? '已删除' : active ? '活动路由' : '待命'}</dd></div>
                            <div><dt>最近测试</dt><dd>{testLabel(events, model.configDigest)}</dd></div>
                            <div><dt>成本</dt><dd>{model.inputUsdPerMillion === null || model.outputUsdPerMillion === null ? '未知' : `$${model.inputUsdPerMillion} / $${model.outputUsdPerMillion}`}</dd></div>
                          </dl>
                          <div className={styles.modelActions}>
                            <button type="button" data-testid="provider-model-test" disabled={Boolean(model.deletedAt)} onClick={() => onTest(model)}>测试</button>
                            <button type="button" disabled={Boolean(model.deletedAt)} onClick={() => onEditModel(selected, model)}>编辑</button>
                            <button type="button" data-testid="provider-model-delete" className={styles.dangerQuietButton} disabled={Boolean(model.deletedAt)} onClick={() => onDeleteModel(model)}>删除</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
