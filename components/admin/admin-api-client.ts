export type ProviderProtocol = 'responses' | 'chat_completions';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;

export interface ProviderModel {
  archivedAt: string | null;
  configDigest: string;
  deletedAt: string | null;
  displayName: string;
  id: string;
  inputUsdPerMillion: string | null;
  maxOutputTokens: number;
  modelId: string;
  outputUsdPerMillion: string | null;
  protocol: ProviderProtocol;
  reasoningEffort: ReasoningEffort;
  seriesId: string;
  version: number;
}

export interface ProviderConnection {
  archivedAt: string | null;
  baseUrl: string;
  deletedAt: string | null;
  displayName: string;
  hasApiKey: boolean;
  id: string;
  models: ProviderModel[];
  seriesId: string;
  userAgent: string | null;
  version: number;
}

export interface ProviderCatalog {
  items: ProviderConnection[];
  limit: number;
  page: number;
  total: number;
}

export interface RuntimeTarget {
  configDigest: string;
  connectionDisplayName: string;
  databaseModelSeriesId: string | null;
  databaseModelVersionId: string | null;
  environmentTargetKey: 'primary' | 'fallback-1' | 'fallback-2' | null;
  inputUsdPerMillion: string | null;
  modelDisplayName: string;
  modelId: string;
  outputUsdPerMillion: string | null;
  position: number;
  protocol: ProviderProtocol;
  sourceType: 'database' | 'environment';
}

export interface EnvironmentTarget {
  configDigest: string;
  connectionDisplayName: string;
  environmentTargetKey: 'primary' | 'fallback-1' | 'fallback-2';
  modelId: string;
  protocol: ProviderProtocol;
}

export interface ProviderRuntimeSummary {
  activeRevision: number;
  canRollback: boolean;
  routeRevisionId: string | null;
  targets: RuntimeTarget[];
  environmentTargets: EnvironmentTarget[];
}

export interface ProviderActivationResult {
  activeRevision: number;
  routeRevisionId: string;
  targets: RuntimeTarget[];
}

export interface ProviderEvent {
  configDigest: string | null;
  createdAt: string;
  eventType: string;
  id: string;
  itemCount: number | null;
  latencyMs: number | null;
  resultCode: string;
  status: string;
}

export interface ProviderEventList {
  items: ProviderEvent[];
  limit: number;
  page: number;
  total: number;
}

export interface ModelInput {
  displayName: string;
  inputUsdPerMillion: string | null;
  maxOutputTokens: number;
  modelId: string;
  outputUsdPerMillion: string | null;
  protocol: ProviderProtocol;
  reasoningEffort: ReasoningEffort;
}

export interface ConnectionInput {
  apiKey: string;
  baseUrl: string;
  firstModel: ModelInput;
  name: string;
  userAgent: string | null;
}

export type RouteTargetInput =
  | { source: 'database'; modelId: string; modelVersionId: string }
  | { source: 'environment'; environmentTargetKey: EnvironmentTarget['environmentTargetKey'] };

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
  ) {
    super(providerErrorMessage(status, code));
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
  }
}

export function buildProviderCatalogQuery(includeDeleted: boolean): string {
  return new URLSearchParams({
    page: '1',
    limit: '100',
    includeDeleted: String(includeDeleted),
  }).toString();
}

export function providerErrorMessage(status: number, code = ''): string {
  const messages: Record<string, string> = {
    ADMIN_AUTH_REQUIRED: '管理会话已过期，请重新登录。',
    ADMIN_REAUTH_FAILED: '管理密码不正确，请重新输入。',
    ADMIN_ORIGIN_REQUIRED: '当前站点来源未获管理权限，请检查管理域名配置。',
    AI_CONFIG_CONFLICT: '其他管理页面已更新活动路由，请刷新最新配置后重试。',
    AI_CONFIG_HISTORY_RETAINED: '历史记录已保留，敏感凭据已按删除策略处理。',
    AI_CONFIG_IN_USE: '该目标仍在活动路由中，请先编辑路由并移除。',
    AI_CONFIG_INVALID: '配置无效，请检查必填字段、URL、协议和路由顺序。',
    AI_CONFIG_RATE_LIMITED: '发现或测试操作过于频繁，请稍后再试。',
    AI_CONFIG_SECRET_UNAVAILABLE: '加密凭据不可用，请更新 API Key 后重试。',
    AI_CONFIG_TARGET_DELETED: '路由目标已删除，请刷新配置并选择可用目标。',
    AI_CONFIG_TEST_FAILED: '中转测试未通过，请检查协议、模型 ID 和连接状态。',
    AI_CONFIG_TEST_REQUIRED: '配置已变化或测试已过期，请重新测试后激活。',
    AI_CONFIG_UNAVAILABLE: 'API 配置服务暂时不可用，请检查数据库和环境主密钥。',
  };
  if (messages[code]) return messages[code];
  if (status === 401) return messages.ADMIN_AUTH_REQUIRED;
  if (status === 403) return messages.ADMIN_ORIGIN_REQUIRED;
  if (status === 429) return messages.AI_CONFIG_RATE_LIMITED;
  if (status === 503) return messages.AI_CONFIG_UNAVAILABLE;
  return '操作未完成，请检查连接后重试。';
}

async function requestJson<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(pathname, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: init.body
      ? { 'Content-Type': 'application/json', ...init.headers }
      : init.headers,
  });
  if (!response.ok) {
    let code = '';
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string') code = payload.error;
    } catch {
      // Malformed responses still map to stable operator-facing copy.
    }
    throw new AdminApiError(response.status, code);
  }
  return response.json() as Promise<T>;
}

function jsonBody(input: unknown): string {
  return JSON.stringify(input);
}

export function getProviderRuntime(signal?: AbortSignal) {
  return requestJson<ProviderRuntimeSummary>('/api/admin/providers/runtime', { signal });
}

export function getProviderCatalog(includeDeleted: boolean, signal?: AbortSignal) {
  return requestJson<ProviderCatalog>(
    `/api/admin/providers?${buildProviderCatalogQuery(includeDeleted)}`,
    { signal },
  );
}

export function getProviderEvents(signal?: AbortSignal) {
  return requestJson<ProviderEventList>('/api/admin/providers/events?page=1&limit=100', { signal });
}

export function createConnection(input: ConnectionInput, password: string) {
  return requestJson<{ connectionSeriesId: string; modelSeriesId: string }>('/api/admin/providers', {
    method: 'POST',
    body: jsonBody({ ...input, password }),
  });
}

export function updateConnection(
  connectionId: string,
  input: Omit<ConnectionInput, 'firstModel' | 'apiKey'> & { apiKey: string | null; reuseKeyAcrossOrigin: boolean },
  password: string,
) {
  return requestJson<{ connectionVersion: number }>(`/api/admin/providers/${connectionId}`, {
    method: 'PATCH',
    body: jsonBody({ ...input, password }),
  });
}

export function createModel(connectionId: string, input: ModelInput, password: string) {
  return requestJson<{ modelSeriesId: string }>(`/api/admin/providers/${connectionId}/models`, {
    method: 'POST',
    body: jsonBody({ ...input, password }),
  });
}

export function updateModel(modelId: string, input: ModelInput, password: string) {
  return requestJson<{ modelVersion: number }>(`/api/admin/providers/models/${modelId}`, {
    method: 'PATCH',
    body: jsonBody({ ...input, password }),
  });
}

export function discoverModels(connectionId: string, password: string) {
  return requestJson<{ items: string[] }>(`/api/admin/providers/${connectionId}/discover`, {
    method: 'POST',
    body: jsonBody({ password }),
  });
}

export function testModel(modelId: string, password: string) {
  return requestJson<{ testedAt: string; latencyMs: number }>(
    `/api/admin/providers/models/${modelId}/test`,
    { method: 'POST', body: jsonBody({ password }) },
  );
}

export function testEnvironmentTarget(targetKey: EnvironmentTarget['environmentTargetKey'], password: string) {
  return requestJson<{ testedAt: string; latencyMs: number }>(
    `/api/admin/providers/runtime/environment/${targetKey}/test`,
    { method: 'POST', body: jsonBody({ password }) },
  );
}

export function activateRoute(expectedActiveRevision: number, targets: RouteTargetInput[], password: string) {
  return requestJson<ProviderActivationResult>('/api/admin/providers/routes/activate', {
    method: 'POST',
    body: jsonBody({ expectedActiveRevision, targets, password }),
  });
}

export function rollbackRoute(expectedActiveRevision: number, password: string) {
  return requestJson<ProviderActivationResult>('/api/admin/providers/routes/activate', {
    method: 'POST',
    body: jsonBody({ expectedActiveRevision, rollbackToPrevious: true, password }),
  });
}

export function deleteModel(modelId: string, confirmationName: string, password: string) {
  return requestJson<{ disposition: 'deleted' | 'history_retained' }>(
    `/api/admin/providers/models/${modelId}`,
    { method: 'DELETE', body: jsonBody({ confirmationName, password }) },
  );
}

export function deleteConnection(connectionId: string, confirmationName: string, password: string) {
  return requestJson<{ disposition: 'deleted' | 'history_retained' }>(
    `/api/admin/providers/${connectionId}`,
    { method: 'DELETE', body: jsonBody({ confirmationName, password }) },
  );
}
