export type AdminWorkflow = 'chat' | 'jd_match' | 'diagnosis';
export type AdminTurnStatus = 'running' | 'completed' | 'stopped' | 'failed';
export type AdminExportFormat = 'json' | 'csv';

export interface AdminFilters {
  from: string;
  to: string;
  workflow: '' | AdminWorkflow;
  status: '' | AdminTurnStatus;
  usedSearch: '' | 'true' | 'false';
  badcase: '' | 'true' | 'false';
  page: number;
  limit: number;
}

export interface AdminSource {
  id: string;
  title: string;
  href: string;
  kind: 'local' | 'official' | 'github' | 'web';
  domain: string | null;
  score: number | null;
}

export interface AdminTurnSummary {
  id: string;
  accessSessionId: string;
  conversationId: string | null;
  workflow: AdminWorkflow;
  audienceIntent: string;
  question: string;
  answer: string | null;
  status: AdminTurnStatus;
  errorCode: string | null;
  knowledgeSources: AdminSource[];
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  usedSearch: boolean;
  badcase: boolean;
  adminNote: string | null;
  createdAt: string;
  completedAt: string | null;
  deleteAfter: string;
}

export interface AdminSearchDetail {
  id: string;
  query: string;
  routeReason: string;
  status: 'pending' | 'completed' | 'failed';
  results: unknown;
  errorCode: string | null;
  createdAt: string;
  deleteAfter: string;
}

export interface AdminDiagnosisDetail {
  id: string;
  fields: Record<string, unknown>;
  summary: string;
  status: 'collecting' | 'complete' | 'handoff_pending' | 'notified';
  notificationStatus: 'pending' | 'sent' | 'failed' | 'not_required';
  createdAt: string;
  completedAt: string | null;
  deleteAfter: string;
}

export interface AdminTurnDetail extends AdminTurnSummary {
  search: AdminSearchDetail | null;
  diagnosis: AdminDiagnosisDetail | null;
}

export interface AdminTurnList {
  items: AdminTurnSummary[];
  total: number;
  page: number;
  limit: number;
}

export const defaultAdminFilters: AdminFilters = {
  from: '',
  to: '',
  workflow: '',
  status: '',
  usedSearch: '',
  badcase: '',
  page: 1,
  limit: 20,
};

export function normalizeAdminFilters(filters: AdminFilters): AdminFilters {
  const normalizeDate = (value: string) => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  };
  return {
    ...filters,
    from: normalizeDate(filters.from),
    to: normalizeDate(filters.to),
  };
}

export function buildAdminQuery(filters: AdminFilters): string {
  const normalized = normalizeAdminFilters(filters);
  const params = new URLSearchParams();
  if (normalized.from) params.set('from', normalized.from);
  if (normalized.to) params.set('to', normalized.to);
  if (normalized.workflow) params.set('workflow', normalized.workflow);
  if (normalized.status) params.set('status', normalized.status);
  if (normalized.usedSearch) params.set('usedSearch', normalized.usedSearch);
  if (normalized.badcase) params.set('badcase', normalized.badcase);
  params.set('page', String(filters.page));
  params.set('limit', String(filters.limit));
  return params.toString();
}

export function adminErrorMessage(status: number, code = ''): string {
  if (code === 'ADMIN_AUTH_FAILED') {
    return '密码或动态验证码无效，也可能已触发临时锁定。';
  }
  if (code === 'ADMIN_TOTP_REQUIRED') {
    return '动态验证码无效、已使用或已过期，请输入新的验证码。';
  }
  if (status === 401 || code === 'ADMIN_AUTH_REQUIRED') {
    return '管理会话已过期，请重新登录。';
  }
  if (status === 403 || code === 'ADMIN_ORIGIN_REQUIRED') {
    return '当前站点来源未获管理权限，请检查管理域名配置。';
  }
  if (code === 'INVALID_ADMIN_FILTER') {
    return '筛选条件无效，请检查时间范围后重试。';
  }
  if (code === 'INVALID_BADCASE_UPDATE') {
    return '复盘备注无效，备注最多 2,000 字。';
  }
  if (status === 404 || code === 'ADMIN_TURN_NOT_FOUND') {
    return '这条记录已过保留期或不存在，请刷新列表。';
  }
  if (status === 503 || code === 'ADMIN_UNAVAILABLE') {
    return '管理服务暂时不可用，请稍后重试。';
  }
  return '操作未完成，请检查连接后重试。';
}

export function exportFileName(
  contentDisposition: string | null,
  format: AdminExportFormat,
): string {
  const candidate = contentDisposition?.match(/filename="([A-Za-z0-9._-]+)"/u)?.[1] ?? '';
  if (new RegExp(`^morse-interactions-\\d{4}-\\d{2}-\\d{2}\\.${format}$`, 'u').test(candidate)) {
    return candidate;
  }
  const date = new Date().toISOString().slice(0, 10);
  return `morse-interactions-${date}.${format}`;
}

export async function responseError(response: Response): Promise<string> {
  let code = '';
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === 'string') code = payload.error;
  } catch {
    // A malformed error body still maps to a stable public message.
  }
  return adminErrorMessage(response.status, code);
}
