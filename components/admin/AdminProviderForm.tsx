'use client';

import { useEffect, useState } from 'react';

import type {
  ConnectionInput,
  EnvironmentTakeoverInput,
  EnvironmentTarget,
  ModelInput,
  ProviderConnection,
  ProviderModel,
  ProviderProtocol,
  ReasoningEffort,
} from './admin-api-client';
import styles from './AdminApiConsole.module.css';

export type ProviderFormMode = 'create_connection' | 'edit_connection' | 'create_model' | 'edit_model' | 'takeover_environment';

export type ProviderFormValue =
  | { mode: 'create_connection'; connection: ConnectionInput }
  | { mode: 'edit_connection'; connection: Omit<ConnectionInput, 'firstModel' | 'apiKey'> & { apiKey: string | null; reuseKeyAcrossOrigin: boolean } }
  | { mode: 'create_model' | 'edit_model'; model: ModelInput }
  | { mode: 'takeover_environment'; takeover: EnvironmentTakeoverInput & { environmentTargetKey: EnvironmentTarget['environmentTargetKey'] } };

interface Props {
  connection?: ProviderConnection | null;
  discoveredModels?: string[];
  environmentTarget?: EnvironmentTarget | null;
  mode: ProviderFormMode;
  model?: ProviderModel | null;
  open: boolean;
  requestId?: string | null;
  onCancel: () => void;
  onSubmit: (value: ProviderFormValue) => void;
}

const emptyModel: ModelInput = {
  displayName: '',
  inputUsdPerMillion: null,
  maxOutputTokens: 4096,
  modelId: '',
  outputUsdPerMillion: null,
  protocol: 'responses',
  reasoningEffort: null,
};

function modelFrom(value?: ProviderModel | null): ModelInput {
  return value ? {
    displayName: value.displayName,
    inputUsdPerMillion: value.inputUsdPerMillion,
    maxOutputTokens: value.maxOutputTokens,
    modelId: value.modelId,
    outputUsdPerMillion: value.outputUsdPerMillion,
    protocol: value.protocol,
    reasoningEffort: value.reasoningEffort,
  } : emptyModel;
}

export default function AdminProviderForm({
  connection,
  discoveredModels = [],
  environmentTarget,
  mode,
  model,
  open,
  requestId,
  onCancel,
  onSubmit,
}: Props) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlChanged, setBaseUrlChanged] = useState(false);
  const [userAgent, setUserAgent] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [reuseKeyAcrossOrigin, setReuseKeyAcrossOrigin] = useState(false);
  const [modelValue, setModelValue] = useState<ModelInput>(emptyModel);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    const takeover = mode === 'takeover_environment' ? environmentTarget : null;
    setName(takeover?.connectionDisplayName ?? connection?.displayName ?? '');
    setBaseUrl(takeover?.baseUrlMode === 'public_default' ? takeover.baseUrlPrefill ?? '' : connection?.baseUrl ?? '');
    setBaseUrlChanged(false);
    setUserAgent(takeover?.userAgent ?? connection?.userAgent ?? '');
    setApiKey('');
    setShowKey(false);
    setReuseKeyAcrossOrigin(false);
    setModelValue(takeover ? {
      displayName: takeover.modelDisplayName,
      inputUsdPerMillion: takeover.inputUsdPerMillion,
      maxOutputTokens: takeover.maxOutputTokens,
      modelId: takeover.modelId,
      outputUsdPerMillion: takeover.outputUsdPerMillion,
      protocol: takeover.protocol,
      reasoningEffort: takeover.reasoningEffort,
    } : modelFrom(model));
  }, [connection, environmentTarget, mode, model, open]);

  if (!open) return null;
  const takeover = mode === 'takeover_environment' ? environmentTarget ?? null : null;
  const connectionMode = mode === 'create_connection' || mode === 'edit_connection' || Boolean(takeover);
  const createConnection = mode === 'create_connection';
  const twoStep = createConnection || Boolean(takeover);
  const showConnection = connectionMode && (!twoStep || step === 1);
  const title = mode === 'create_connection'
    ? '新增中转'
    : mode === 'edit_connection'
      ? '编辑中转'
      : mode === 'create_model'
        ? '新增模型'
        : mode === 'takeover_environment'
          ? '接管环境 Provider'
          : '编辑模型';

  function updateModel<K extends keyof ModelInput>(key: K, value: ModelInput[K]) {
    setModelValue((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (showConnection && twoStep && step === 1) {
      setStep(2);
      return;
    }
    if (mode === 'create_connection') {
      onSubmit({
        mode,
        connection: {
          apiKey,
          baseUrl,
          firstModel: modelValue,
          name,
          userAgent: userAgent.trim() || null,
        },
      });
      return;
    }
    if (mode === 'edit_connection') {
      onSubmit({
        mode,
        connection: {
          apiKey: apiKey || null,
          baseUrl,
          name,
          reuseKeyAcrossOrigin,
          userAgent: userAgent.trim() || null,
        },
      });
      return;
    }
    if (mode === 'takeover_environment' && takeover && requestId) {
      onSubmit({
        mode,
        takeover: {
          apiKey: apiKey.trim() || null,
          baseUrl: baseUrl.trim() || null,
          environmentTargetKey: takeover.environmentTargetKey,
          expectedConfigDigest: takeover.configDigest,
          firstModel: modelValue,
          name,
          requestId,
          reuseKeyAcrossOrigin,
          userAgent: userAgent.trim() || null,
        },
      });
      return;
    }
    if (mode === 'create_model' || mode === 'edit_model') onSubmit({ mode, model: modelValue });
  }

  return (
    <div className={styles.layerBackdrop}>
      <section className={styles.formLayer} role="dialog" aria-modal="true" aria-labelledby="provider-form-title">
        <header className={styles.layerHeader}>
          <button type="button" className={styles.backButton} onClick={onCancel}>← 返回</button>
          <div>
            <p className={styles.eyebrow}>{twoStep ? `STEP ${step} / 2` : 'CONFIGURATION'}</p>
            <h2 id="provider-form-title">{title}</h2>
          </div>
        </header>
        <form className={styles.providerForm} onSubmit={submit}>
          {showConnection ? (
            <>
              <label className={styles.field}>
                中转名称
                <input name="connectionName" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className={styles.field}>
                Base URL
                <input name="baseUrl" required={!takeover || takeover.baseUrlMode === 'replacement_required'} type="url" maxLength={2048} placeholder="https://gateway.example/v1" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); setBaseUrlChanged(true); }} />
              </label>
              {takeover && (takeover.baseUrlMode === 'server_reusable'
                || (takeover.baseUrlMode === 'public_default' && !takeover.baseUrlPrefill)) ? (
                  <p className={styles.formHint}>将安全沿用当前服务器 URL</p>
                ) : null}
              {takeover?.baseUrlMode === 'replacement_required' ? <p className={styles.errorText}>当前服务器 URL 不能安全复用，必须填写新的 Base URL。</p> : null}
              <label className={styles.field}>
                User-Agent（可选）
                <input name="userAgent" maxLength={256} value={userAgent} onChange={(event) => setUserAgent(event.target.value)} />
              </label>
              <label className={styles.field}>
                API Key {mode === 'edit_connection' && connection?.hasApiKey ? '（已安全保存，留空即沿用）' : ''}
                <input
                  required={createConnection}
                  name="apiKey"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={showKey} onChange={(event) => setShowKey(event.target.checked)} />
                显示 Key
              </label>
              {mode === 'edit_connection' ? (
                <label className={styles.checkField}>
                  <input type="checkbox" checked={reuseKeyAcrossOrigin} onChange={(event) => setReuseKeyAcrossOrigin(event.target.checked)} />
                  Base URL 跨 origin 时明确沿用旧 Key
                </label>
              ) : null}
              {takeover ? (
                <>
                  <p className={styles.formHint}>将安全沿用当前服务器 Key</p>
                  {baseUrlChanged && baseUrl.trim() && !apiKey.trim() ? (
                    <label className={styles.checkField}>
                      <input required type="checkbox" checked={reuseKeyAcrossOrigin} onChange={(event) => setReuseKeyAcrossOrigin(event.target.checked)} />
                      Base URL 已替换，确认沿用服务器 Key
                    </label>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <>
              {discoveredModels.length > 0 ? (
                <label className={styles.field}>
                  获取模型列表结果
                  <select value={modelValue.modelId} onChange={(event) => updateModel('modelId', event.target.value)}>
                    <option value="">手动输入</option>
                    {discoveredModels.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              ) : null}
              <label className={styles.field}>
                显示名称
                <input name="modelDisplayName" required maxLength={80} value={modelValue.displayName} onChange={(event) => updateModel('displayName', event.target.value)} />
              </label>
              <label className={styles.field}>
                模型 ID
                <input name="modelId" required maxLength={200} value={modelValue.modelId} onChange={(event) => updateModel('modelId', event.target.value)} />
              </label>
              <fieldset className={styles.segmentField}>
                <legend>协议</legend>
                {(['responses', 'chat_completions'] as ProviderProtocol[]).map((protocol) => (
                  <label key={protocol} data-active={modelValue.protocol === protocol}>
                    <input type="radio" name="protocol" value={protocol} checked={modelValue.protocol === protocol} onChange={() => updateModel('protocol', protocol)} />
                    {protocol === 'responses' ? 'Responses' : 'Chat Completions'}
                  </label>
                ))}
              </fieldset>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  推理强度
                  <select value={modelValue.reasoningEffort ?? ''} onChange={(event) => updateModel('reasoningEffort', (event.target.value || null) as ReasoningEffort)}>
                    <option value="">不设置</option>
                    {['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  最大输出 Token
                  <input name="maxOutputTokens" required type="number" min={1} max={100000} value={modelValue.maxOutputTokens} onChange={(event) => updateModel('maxOutputTokens', Number(event.target.value))} />
                </label>
                <label className={styles.field}>
                  输入单价 / 百万 Token
                  <input type="number" min={0} max={100000} step="0.000001" value={modelValue.inputUsdPerMillion ?? ''} onChange={(event) => updateModel('inputUsdPerMillion', event.target.value || null)} />
                </label>
                <label className={styles.field}>
                  输出单价 / 百万 Token
                  <input type="number" min={0} max={100000} step="0.000001" value={modelValue.outputUsdPerMillion ?? ''} onChange={(event) => updateModel('outputUsdPerMillion', event.target.value || null)} />
                </label>
              </div>
            </>
          )}
          <footer className={styles.formActions}>
            {twoStep && step === 2 ? (
              <button type="button" className={styles.quietButton} onClick={() => setStep(1)}>上一步</button>
            ) : (
              <button type="button" className={styles.quietButton} onClick={onCancel}>取消</button>
            )}
            <button type="submit" className={styles.primaryButton}>
              {twoStep && step === 1 ? '下一步：模型配置' : '保存并复验密码'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
