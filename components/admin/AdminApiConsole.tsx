'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  activateRoute,
  AdminApiError,
  createConnection,
  createModel,
  deleteConnection,
  deleteModel,
  discoverModels,
  getProviderCatalog,
  getProviderEvents,
  getProviderRuntime,
  rollbackRoute,
  testEnvironmentTarget,
  testModel,
  updateConnection,
  updateModel,
  type ProviderCatalog,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderEventList,
  type ProviderModel,
  type ProviderRuntimeSummary,
  type RouteTargetInput,
} from './admin-api-client';
import AdminProviderForm, {
  type ProviderFormMode,
  type ProviderFormValue,
} from './AdminProviderForm';
import AdminProviderLibrary from './AdminProviderLibrary';
import AdminReauthDialog, { type ReauthKind } from './AdminReauthDialog';
import AdminRouteEditor, { type RouteCandidate } from './AdminRouteEditor';
import { useAdminSession } from './AdminShell';
import styles from './AdminApiConsole.module.css';

interface FormState {
  connection: ProviderConnection | null;
  mode: ProviderFormMode;
  model: ProviderModel | null;
}

interface PendingAction {
  confirmationName?: string;
  kind: ReauthKind;
  run: (password: string, confirmation: string) => Promise<string>;
  title: string;
}

function targetTestLabel(events: ProviderEvent[], digest: string): string {
  const event = events.find((item) => item.configDigest === digest
    && ['provider_test', 'environment_test'].includes(item.eventType));
  if (!event) return '未测试';
  if (event.status !== 'succeeded') return '测试失败';
  const age = Date.now() - new Date(event.createdAt).getTime();
  return age <= 30 * 60_000 ? `测试通过 · ${event.latencyMs ?? '-'}ms` : '测试已过期';
}

function dispositionMessage(kind: '中转' | '模型', disposition: 'deleted' | 'history_retained'): string {
  return disposition === 'deleted'
    ? `${kind}已物理删除。`
    : `${kind}已从可用配置中删除；历史元数据保留，敏感凭据已销毁。`;
}

function newestActivation(events: ProviderEvent[]): ProviderEvent | null {
  return events.find((event) => ['route_activated', 'route_rolled_back'].includes(event.eventType)) ?? null;
}

export default function AdminApiConsole() {
  const { requireLogin } = useAdminSession();
  const [runtime, setRuntime] = useState<ProviderRuntimeSummary | null>(null);
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [events, setEvents] = useState<ProviderEventList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permission, setPermission] = useState<'authorized' | 'denied'>('authorized');
  const [reloadRevision, setReloadRevision] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);

  const refresh = useCallback(() => setReloadRevision((revision) => revision + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setPermission('authorized');
    Promise.all([
      getProviderRuntime(controller.signal),
      getProviderCatalog(includeDeleted, controller.signal),
      getProviderEvents(controller.signal),
    ]).then(([nextRuntime, nextCatalog, nextEvents]) => {
      setRuntime(nextRuntime);
      setCatalog(nextCatalog);
      setEvents(nextEvents);
      setSelectedId((current) => (
        current && nextCatalog.items.some((item) => item.seriesId === current)
          ? current
          : nextCatalog.items[0]?.seriesId ?? null
      ));
    }).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      if (caught instanceof AdminApiError && caught.status === 401) {
        setPermission('denied');
        requireLogin(caught.message);
        return;
      }
      setError(caught instanceof Error ? caught.message : '无法加载 API 配置。');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [includeDeleted, reloadRevision, requireLogin]);

  const allEvents = events?.items ?? [];
  const candidates = useMemo<RouteCandidate[]>(() => {
    if (!runtime || !catalog) return [];
    const result: RouteCandidate[] = runtime.environmentTargets.map((target) => ({
      configDigest: target.configDigest,
      identity: `environment:${target.environmentTargetKey}`,
      key: `environment:${target.environmentTargetKey}:${target.configDigest}`,
      label: target.connectionDisplayName,
      meta: `${target.endpointHost ?? '来源不可用'} · ${target.modelId} · ${target.protocol}`,
      target: { source: 'environment', environmentTargetKey: target.environmentTargetKey },
      testLabel: targetTestLabel(allEvents, target.configDigest),
    }));
    for (const connection of catalog.items) {
      if (connection.deletedAt) continue;
      for (const model of connection.models) {
        if (model.deletedAt) continue;
        result.push({
          configDigest: model.configDigest,
          identity: `database:${model.seriesId}`,
          key: `database:${model.seriesId}:${model.configDigest}`,
          label: `${connection.displayName} / ${model.displayName}`,
          meta: `${model.modelId} · ${model.protocol}`,
          target: { source: 'database', modelId: model.seriesId, modelVersionId: model.id },
          testLabel: targetTestLabel(allEvents, model.configDigest),
        });
      }
    }
    for (const target of runtime.targets) {
      const existing = result.find((candidate) => candidate.configDigest === target.configDigest);
      if (existing || target.sourceType !== 'database') continue;
      const currentModel = catalog.items.flatMap((connection) => connection.models.map((model) => ({ connection, model })))
        .find(({ model }) => model.seriesId === target.databaseModelSeriesId);
      if (!currentModel || !target.databaseModelSeriesId || !target.databaseModelVersionId) continue;
      result.push({
        configDigest: target.configDigest,
        identity: `database:${target.databaseModelSeriesId}`,
        key: `database:${target.databaseModelSeriesId}:${target.configDigest}`,
        label: `${target.connectionDisplayName} / ${target.modelDisplayName}`,
        meta: `${target.modelId} · 活动历史快照`,
        target: {
          source: 'database',
          modelId: target.databaseModelSeriesId,
          modelVersionId: target.databaseModelVersionId,
        },
        testLabel: '当前活动快照',
      });
    }
    return result;
  }, [allEvents, catalog, runtime]);

  const currentKeys = useMemo(() => runtime?.targets.map((target) => {
    const candidate = candidates.find((item) => item.configDigest === target.configDigest);
    return candidate?.key ?? '';
  }).filter(Boolean) ?? [], [candidates, runtime]);

  function queue(action: PendingAction) {
    setActionError('');
    setPending(action);
  }

  async function confirmAction(password: string, confirmation: string) {
    if (!pending) return;
    setActionBusy(true);
    setActionError('');
    try {
      const message = await pending.run(password, confirmation);
      setNotice(message);
      setPending(null);
      setForm(null);
      setConflict(false);
      refresh();
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401 && caught.code === 'ADMIN_AUTH_REQUIRED') {
        setPermission('denied');
        setPending(null);
        requireLogin(caught.message);
        return;
      }
      if (caught instanceof AdminApiError && caught.code === 'AI_CONFIG_CONFLICT') setConflict(true);
      setActionError(caught instanceof Error ? caught.message : '操作未完成。');
    } finally {
      setActionBusy(false);
    }
  }

  function submitForm(value: ProviderFormValue) {
    queue({
      kind: 'save',
      title: value.mode === 'create_connection' ? '保存新中转' : value.mode === 'edit_connection' ? '保存中转版本' : '保存模型版本',
      run: async (password) => {
        if (value.mode === 'create_connection') {
          await createConnection(value.connection, password);
          return '中转和首个模型已保存；请显式测试后加入路由。';
        }
        if (value.mode === 'edit_connection') {
          if (!form?.connection) throw new Error('缺少中转上下文。');
          await updateConnection(form.connection.seriesId, value.connection, password);
          return '中转新版本已保存，关联模型需要重新测试。';
        }
        if (!form?.connection) throw new Error('缺少中转上下文。');
        if (value.mode === 'create_model') {
          await createModel(form.connection.seriesId, value.model, password);
          return '模型已保存，请完成连接测试。';
        }
        if (!form.model) throw new Error('缺少模型上下文。');
        await updateModel(form.model.seriesId, value.model, password);
        return '模型新版本已保存，需要重新测试后激活。';
      },
    });
  }

  function discover(connection: ProviderConnection) {
    queue({
      kind: 'discover',
      title: `从 ${connection.displayName} 获取模型列表`,
      run: async (password) => {
        const result = await discoverModels(connection.seriesId, password);
        setDiscoveredModels(result.items);
        setForm({ connection, mode: 'create_model', model: null });
        return `已获取 ${result.items.length} 个模型，可选择或手动输入。`;
      },
    });
  }

  function testDatabaseModel(model: ProviderModel) {
    queue({
      kind: 'test',
      title: `测试 ${model.displayName}`,
      run: async (password) => {
        const result = await testModel(model.seriesId, password);
        return `测试通过，延迟 ${result.latencyMs}ms。`;
      },
    });
  }

  function testEnvironment(key: 'primary' | 'fallback-1' | 'fallback-2', label: string) {
    queue({
      kind: 'test',
      title: `测试 ${label}`,
      run: async (password) => {
        const result = await testEnvironmentTarget(key, password);
        return `环境线路测试通过，延迟 ${result.latencyMs}ms。`;
      },
    });
  }

  function activate(targets: RouteTargetInput[]) {
    if (!runtime) return;
    queue({
      kind: 'activate',
      title: '激活全站对话路由',
      run: async (password) => {
        const next = await activateRoute(runtime.activeRevision, targets, password);
        setRouteOpen(false);
        return `路由 v${next.activeRevision} 已激活。`;
      },
    });
  }

  function rollback() {
    if (!runtime?.canRollback) return;
    queue({
      kind: 'activate',
      title: '回退到上一活动版本',
      run: async (password) => {
        const next = await rollbackRoute(runtime.activeRevision, password);
        return `路由 v${next.activeRevision} 已回退。`;
      },
    });
  }

  const active = runtime?.targets[0] ?? null;
  const activeEnvironment = runtime?.environmentTargets[0] ?? null;
  const activeEndpointHost = active?.endpointHost ?? activeEnvironment?.endpointHost ?? null;
  const activeModelId = active?.modelId ?? activeEnvironment?.modelId ?? '未配置';
  const activeProtocol = active?.protocol ?? activeEnvironment?.protocol;
  const activation = newestActivation(allEvents);

  if (loading && !runtime) {
    return <main className={styles.statePage} data-state="loading" role="status">正在加载全站 API 配置...</main>;
  }

  if (error || !runtime || !catalog || !events) {
    return (
      <main className={styles.statePage} data-state="error">
        <p role="alert">{error || 'API 配置暂时不可用。'}</p>
        <button type="button" className={styles.secondaryButton} onClick={refresh}>重新加载</button>
      </main>
    );
  }

  return (
    <main
      className={styles.console}
      data-testid="admin-api-console"
      data-permission={permission}
      data-empty={catalog.items.length === 0 ? 'true' : 'false'}
      aria-busy={loading}
    >
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>OPENAI-COMPATIBLE / GLOBAL</p>
          <h1>API 配置</h1>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.secondaryButton} data-testid="route-rollback" disabled={loading || !runtime.canRollback} onClick={rollback}>
            回退上一版
          </button>
          <button type="button" className={styles.primaryButton} data-testid="route-editor-open" disabled={loading} onClick={() => setRouteOpen(true)}>
            编辑路由
          </button>
        </div>
      </header>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {conflict ? (
        <div className={styles.conflict} role="alert" data-error-code="AI_CONFIG_CONFLICT">
          <span>其他管理页面已经修改活动路由，当前草稿未提交。</span>
          <button type="button" onClick={() => { setPending(null); setConflict(false); refresh(); }}>刷新最新配置</button>
        </div>
      ) : null}

      <section className={styles.runtimeBand} aria-labelledby="runtime-summary-title">
        <div className={styles.runtimeLead}>
          <p className={styles.eyebrow}>CURRENT ROUTE</p>
          <h2 id="runtime-summary-title">当前主线路</h2>
          <strong>{active ? `${active.connectionDisplayName} / ${active.modelDisplayName}` : '环境默认路由'}</strong>
          <span className={`${styles.endpointHost} ${styles.longText}`} data-testid="active-endpoint-host">
            {activeEndpointHost ?? '来源不可用'}
          </span>
          <span className={styles.longText}>{activeModelId}{activeProtocol ? ` · ${activeProtocol}` : ''}</span>
        </div>
        <dl className={styles.runtimeFacts}>
          <div><dt>活动版本</dt><dd>v{runtime.activeRevision || 0}</dd></div>
          <div><dt>备用线路</dt><dd>{Math.max(0, runtime.targets.length - 1)} 条</dd></div>
          <div><dt>最近激活</dt><dd>{activation ? new Date(activation.createdAt).toLocaleString('zh-CN') : '环境基线'}</dd></div>
          <div><dt>路由来源</dt><dd>{runtime.routeRevisionId ? '数据库动态配置' : '环境配置'}</dd></div>
        </dl>
        <ol className={styles.runtimeRoute}>
          {(runtime.targets.length > 0 ? runtime.targets : runtime.environmentTargets).map((target, index) => (
            <li key={target.configDigest}>
              <span>{index === 0 ? '主' : index}</span>
              <span>
                <strong>{target.connectionDisplayName}</strong>
                <small className={`${styles.endpointHost} ${styles.longText}`} data-testid="route-endpoint-host">
                  {target.endpointHost ?? '来源不可用'}
                </small>
                <small className={styles.longText}>{target.modelId} · {target.protocol}</small>
              </span>
              <button
                type="button"
                className={styles.testButton}
                onClick={() => {
                  if ('environmentTargetKey' in target && target.environmentTargetKey) {
                    testEnvironment(target.environmentTargetKey, target.connectionDisplayName);
                    return;
                  }
                  const model = catalog.items.flatMap((connection) => connection.models)
                    .find((item) => item.configDigest === target.configDigest);
                  if (model) testDatabaseModel(model);
                }}
              >{targetTestLabel(allEvents, target.configDigest)}</button>
            </li>
          ))}
        </ol>
      </section>

      <AdminProviderLibrary
        catalog={catalog}
        events={allEvents}
        includeDeleted={includeDeleted}
        mobileOpen={mobileDetails}
        runtime={runtime}
        selectedId={selectedId}
        onAddModel={(connection) => { setDiscoveredModels([]); setForm({ connection, mode: 'create_model', model: null }); }}
        onBack={() => setMobileDetails(false)}
        onCreate={() => { setDiscoveredModels([]); setForm({ connection: null, mode: 'create_connection', model: null }); }}
        onDeleteConnection={(connection) => queue({
          kind: 'delete', confirmationName: connection.displayName, title: `删除中转 ${connection.displayName}`,
          run: async (password, confirmation) => dispositionMessage('中转', (await deleteConnection(connection.seriesId, confirmation, password)).disposition),
        })}
        onDeleteModel={(model) => queue({
          kind: 'delete', confirmationName: model.displayName, title: `删除模型 ${model.displayName}`,
          run: async (password, confirmation) => dispositionMessage('模型', (await deleteModel(model.seriesId, confirmation, password)).disposition),
        })}
        onDiscover={discover}
        onEditConnection={(connection) => setForm({ connection, mode: 'edit_connection', model: null })}
        onEditModel={(connection, model) => setForm({ connection, mode: 'edit_model', model })}
        onSelect={(connection) => { setSelectedId(connection.seriesId); setMobileDetails(true); }}
        onTest={testDatabaseModel}
        onToggleDeleted={setIncludeDeleted}
      />

      <AdminRouteEditor candidates={candidates} currentKeys={currentKeys} open={routeOpen} onActivate={activate} onClose={() => setRouteOpen(false)} />
      <AdminProviderForm
        connection={form?.connection}
        discoveredModels={discoveredModels}
        mode={form?.mode ?? 'create_connection'}
        model={form?.model}
        open={Boolean(form)}
        onCancel={() => setForm(null)}
        onSubmit={submitForm}
      />
      <AdminReauthDialog
        busy={actionBusy}
        confirmationName={pending?.confirmationName}
        error={actionError}
        kind={pending?.kind ?? 'save'}
        open={Boolean(pending)}
        title={pending?.title ?? ''}
        onCancel={() => { if (!actionBusy) { setPending(null); setActionError(''); } }}
        onConfirm={(password, confirmation) => void confirmAction(password, confirmation)}
      />
    </main>
  );
}
