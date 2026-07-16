export interface FeishuAlertProviderConfig {
  webhookUrl: string;
  timeoutMs: number;
}

export interface FeishuAlert {
  dedupeKey: string;
  category: string;
  payload: Readonly<Record<string, unknown>>;
}

export type FeishuFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FeishuAlertErrorCode =
  | 'FEISHU_HTTP_ERROR'
  | 'FEISHU_API_ERROR'
  | 'FEISHU_RESPONSE_INVALID'
  | 'FEISHU_REQUEST_FAILED'
  | 'FEISHU_TIMEOUT';

export class FeishuAlertError extends Error {
  readonly code: FeishuAlertErrorCode;

  constructor(code: FeishuAlertErrorCode) {
    super(code);
    this.name = 'FeishuAlertError';
    this.code = code;
  }
}

function validateConfig(config: FeishuAlertProviderConfig): string {
  let webhook: URL;
  try {
    webhook = new URL(config.webhookUrl.trim());
  } catch {
    throw new Error('FEISHU_WEBHOOK_INVALID');
  }
  if (
    webhook.protocol !== 'https:'
    || webhook.username
    || webhook.password
    || !Number.isFinite(config.timeoutMs)
    || config.timeoutMs <= 0
  ) {
    throw new Error('FEISHU_WEBHOOK_INVALID');
  }
  return webhook.toString();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function raceWithAbort<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); },
    );
  });
}

const alertPresentation: Record<string, { title: string; template: string }> = {
  invite_first_use: { title: '首次邀请码访问', template: 'blue' },
  diagnosis_complete: { title: '需求初诊待处理', template: 'orange' },
  service_down: { title: '依赖服务故障', template: 'red' },
  service_recovered: { title: '依赖服务恢复', template: 'green' },
  invite_abuse: { title: '邀请码攻击锁定', template: 'red' },
  admin_login_lockout: { title: '管理员登录锁定', template: 'red' },
};

const alertPayloadFields = [
  ['occurredAt', '发生时间'],
  ['lockedUntil', '锁定至'],
  ['dependency', '依赖'],
  ['inviteId', '邀请码事件'],
  ['diagnosisId', '初诊事件'],
  ['incidentId', '故障事件'],
] as const;

function cardText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return null;
  }
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/[\\`\[\]<>]/gu, '\\$&')
    .trim()
    .slice(0, 240) || null;
}

function buildAlertCard(alert: FeishuAlert): Record<string, unknown> {
  const presentation = alertPresentation[alert.category] ?? {
    title: '系统事件',
    template: 'blue',
  };
  const category = cardText(alert.category) ?? 'unknown';
  const eventKey = cardText(alert.dedupeKey) ?? 'unknown';
  const lines = [
    `**事件类型**：${category}`,
    `**事件标识**：${eventKey}`,
  ];
  for (const [field, label] of alertPayloadFields) {
    const value = cardText(alert.payload[field]);
    if (value) lines.push(`**${label}**：${value}`);
  }
  return {
    msg_type: 'interactive',
    card: {
      schema: '2.0',
      config: { update_multi: false },
      header: {
        title: {
          tag: 'plain_text',
          content: `数字摩斯｜${presentation.title}`,
        },
        template: presentation.template,
      },
      body: {
        elements: [{
          tag: 'markdown',
          content: lines.join('\n'),
        }],
      },
    },
  };
}

export class FeishuAlertProvider {
  private readonly webhookUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: FeishuFetch;

  constructor(
    config: FeishuAlertProviderConfig,
    fetcher: FeishuFetch = fetch,
  ) {
    this.webhookUrl = validateConfig(config);
    this.timeoutMs = config.timeoutMs;
    this.fetcher = fetcher;
  }

  async send(alert: FeishuAlert): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new FeishuAlertError('FEISHU_TIMEOUT'));
    }, this.timeoutMs);
    timer.unref?.();

    try {
      const response = await raceWithAbort(this.fetcher(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAlertCard(alert)),
        redirect: 'error',
        signal: controller.signal,
      }), controller.signal);
      if (!response.ok) throw new FeishuAlertError('FEISHU_HTTP_ERROR');
      let payload: unknown;
      try {
        payload = await raceWithAbort(response.json(), controller.signal);
      } catch (error) {
        if (controller.signal.reason instanceof FeishuAlertError) throw error;
        throw new FeishuAlertError('FEISHU_RESPONSE_INVALID');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('code' in payload)) {
        throw new FeishuAlertError('FEISHU_RESPONSE_INVALID');
      }
      if ((payload as { code?: unknown }).code !== 0) {
        throw new FeishuAlertError('FEISHU_API_ERROR');
      }
    } catch (error) {
      if (controller.signal.reason instanceof FeishuAlertError) {
        throw controller.signal.reason;
      }
      if (error instanceof FeishuAlertError) throw error;
      throw new FeishuAlertError('FEISHU_REQUEST_FAILED');
    } finally {
      clearTimeout(timer);
    }
  }
}
