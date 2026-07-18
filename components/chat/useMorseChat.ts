'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isRecoverableChatError,
  normalizeChatErrorCode,
  publicErrorMessage,
} from '@/lib/client/chat-errors';
import { readChatSse, type ChatSsePayload } from '@/lib/client/chat-sse';
import {
  CHAT_PHASES,
  type ChatAudienceIntent,
  type ChatHistoryPayload,
  type ChatMode,
  type ChatPhase,
  type ChatSource,
  type ChatWorkflow,
  type DiagnosisFields,
  type DiagnosisUiStatus,
} from '@/lib/contracts/chat';

export type AccessState = 'checking' | 'locked' | 'authorized';
export type {
  ChatAudienceIntent,
  ChatMode,
  ChatPhase,
  ChatSource,
  ChatWorkflow,
  DiagnosisFields,
} from '@/lib/contracts/chat';
export type DiagnosisStatus = DiagnosisUiStatus;

export interface ChatRequestSnapshot {
  workflow: ChatWorkflow;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  turnId: string;
  displayText: string;
  message?: string;
  jobDescription?: string;
  diagnosis?: DiagnosisFields;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources: ChatSource[];
  error?: boolean;
  retry?: ChatRequestSnapshot;
  complete?: boolean;
  stopped?: boolean;
  diagnosisStatus?: DiagnosisStatus;
}

type StreamPayload = ChatSsePayload;
type HistoryPayload = ChatHistoryPayload;

const emptyDiagnosis: DiagnosisFields = {
  problem: '',
  goal: '',
  currentState: '',
  constraints: '',
  expectedTimeline: '',
};

const validPhases = new Set<ChatPhase>(CHAT_PHASES);

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function diagnosisSummary(fields: DiagnosisFields): string {
  const labels: Record<keyof DiagnosisFields, string> = {
    problem: '问题',
    goal: '目标',
    currentState: '当前状态',
    constraints: '约束',
    expectedTimeline: '预期时间',
  };
  return (Object.keys(labels) as Array<keyof DiagnosisFields>)
    .filter((field) => fields[field].trim())
    .map((field) => `${labels[field]}：${fields[field].trim()}`)
    .join('\n');
}

function modeForWorkflow(workflow: ChatWorkflow): {
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
} {
  if (workflow === 'jd_match') return { mode: 'interviewer', audienceIntent: 'recruiter' };
  if (workflow === 'diagnosis') return { mode: 'general', audienceIntent: 'collaboration' };
  return { mode: 'general', audienceIntent: 'general' };
}

export function useMorseChat() {
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [inviteCode, setInviteCode] = useState('');
  const [accessError, setAccessError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remainingMessages, setRemainingMessages] = useState(0);
  const [workflow, setWorkflowState] = useState<ChatWorkflow>('chat');
  const [mode, setMode] = useState<ChatMode>('general');
  const [audienceIntent, setAudienceIntent] = useState<ChatAudienceIntent>('general');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [diagnosis, setDiagnosis] = useState<DiagnosisFields>(emptyDiagnosis);
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>('idle');
  const [phase, setPhase] = useState<ChatPhase | null>(null);
  const [streaming, setStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setPhase(null);
    setHistoryError('');
    setDiagnosisStatus('idle');
  }, []);

  const restoreHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch('/api/chat/history', { cache: 'no-store' });
      const history = await response.json() as HistoryPayload;
      if (response.status === 401) {
        setAccessState('locked');
        clearConversation();
        return;
      }
      if (!response.ok || !history.ok) {
        setHistoryError('暂时无法恢复上一段对话，可以开始新对话。');
        return;
      }

      setRemainingMessages(history.remainingMessages);
      if (!history.workflow) {
        setWorkflowState('chat');
        setMode('general');
        setAudienceIntent('general');
        setConversationId(null);
        setMessages([]);
        setDraft('');
        setJobDescription('');
        setDiagnosis(emptyDiagnosis);
        setDiagnosisStatus('idle');
        setPhase(null);
        return;
      }

      const workflowContext = modeForWorkflow(history.workflow);
      const restoredAudience = history.audienceIntent ?? workflowContext.audienceIntent;
      setWorkflowState(history.workflow);
      setAudienceIntent(restoredAudience);
      setMode(restoredAudience === 'recruiter' ? 'interviewer' : workflowContext.mode);
      setDraft('');
      setJobDescription('');
      setDiagnosis(emptyDiagnosis);
      setDiagnosisStatus(history.workflow === 'diagnosis' ? 'collecting' : 'idle');
      setPhase(null);
      setConversationId(history.conversationId);
      setMessages(history.messages.map((message, index) => ({
        id: `history-${message.turnId ?? index}-${message.role}-${index}`,
        role: message.role,
        text: message.text,
        sources: message.sources,
        complete: message.role === 'assistant',
      })));
    } catch {
      setHistoryError('暂时无法恢复上一段对话，可以开始新对话。');
    } finally {
      setHistoryLoading(false);
    }
  }, [clearConversation]);

  useEffect(() => {
    let active = true;
    void fetch('/api/access', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: {
        authorized?: boolean;
        expiresAt?: string | null;
        remainingMessages?: number;
      }) => {
        if (!active) return;
        const authorized = Boolean(data.authorized);
        setHistoryLoading(authorized);
        setAccessState(authorized ? 'authorized' : 'locked');
        setExpiresAt(data.expiresAt ?? null);
        setRemainingMessages(data.remainingMessages ?? 0);
      })
      .catch(() => {
        if (!active) return;
        setHistoryLoading(false);
        setAccessState('locked');
      });
    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (accessState !== 'authorized') return;
    void restoreHistory();
  }, [accessState, restoreHistory]);

  function updateAssistant(id: string, update: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => (
      message.id === id ? update(message) : message
    )));
  }

  function setWorkflow(nextWorkflow: ChatWorkflow) {
    if (streaming || workflow === nextWorkflow) return;
    const nextContext = modeForWorkflow(nextWorkflow);
    setWorkflowState(nextWorkflow);
    setMode(nextContext.mode);
    setAudienceIntent(nextContext.audienceIntent);
    setDraft('');
    setJobDescription('');
    setDiagnosis(emptyDiagnosis);
    clearConversation();
  }

  function currentSnapshot(): ChatRequestSnapshot | null {
    const turnId = crypto.randomUUID();
    if (workflow === 'chat') {
      const message = draft.trim();
      if (!message) return null;
      return { workflow, mode, audienceIntent, turnId, displayText: message, message };
    }
    if (workflow === 'jd_match') {
      const normalizedJd = jobDescription.trim();
      if (!normalizedJd) return null;
      return {
        workflow,
        mode,
        audienceIntent,
        turnId,
        displayText: normalizedJd,
        jobDescription: normalizedJd,
      };
    }

    const summary = diagnosisSummary(diagnosis);
    if (!summary) return null;
    return {
      workflow,
      mode,
      audienceIntent,
      turnId,
      displayText: summary,
      diagnosis: { ...diagnosis },
    };
  }

  async function sendSnapshot(
    requestSnapshot: ChatRequestSnapshot,
    retryAssistantId?: string,
  ) {
    if (streaming || abortControllerRef.current) return;
    const assistantId = retryAssistantId ?? crypto.randomUUID();
    if (retryAssistantId) {
      updateAssistant(assistantId, (assistant) => ({
        ...assistant,
        text: '',
        sources: [],
        error: false,
        retry: undefined,
        complete: false,
        stopped: false,
        diagnosisStatus: requestSnapshot.workflow === 'diagnosis' ? 'collecting' : undefined,
      }));
    } else {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'user',
          text: requestSnapshot.displayText,
          sources: [],
        },
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          sources: [],
          diagnosisStatus: requestSnapshot.workflow === 'diagnosis' ? 'collecting' : undefined,
        },
      ]);
    }

    if (requestSnapshot.workflow === 'chat') setDraft('');
    if (requestSnapshot.workflow === 'jd_match') setJobDescription('');
    setStreaming(true);
    setPhase('routing');
    setHistoryError('');
    if (requestSnapshot.workflow === 'diagnosis') setDiagnosisStatus('collecting');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { displayText: _displayText, ...requestBody } = requestSnapshot;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, conversationId }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(failure.error || (response.status === 401 ? 'ACCESS_REQUIRED' : 'CHAT_UNAVAILABLE'));
      }

      await readChatSse<StreamPayload>(response, (event, payload) => {
        if (event === 'status' && payload.stage && validPhases.has(payload.stage)) {
          setPhase(payload.stage);
          if (payload.stage === 'handoff') {
            setDiagnosisStatus('handoff_pending');
            updateAssistant(assistantId, (assistant) => ({
              ...assistant,
              diagnosisStatus: 'handoff_pending',
            }));
          }
        } else if (event === 'meta') {
          setConversationId(payload.conversationId ?? null);
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            sources: payload.sources ?? [],
          }));
        } else if (event === 'delta') {
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            text: assistant.text + (payload.text ?? ''),
          }));
        } else if (event === 'done') {
          if (typeof payload.remainingMessages === 'number') {
            setRemainingMessages(payload.remainingMessages);
          }
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            retry: undefined,
            complete: true,
          }));
        }
      });
    } catch (error) {
      if (isAbortError(error)) {
        updateAssistant(assistantId, (assistant) => ({
          ...assistant,
          stopped: true,
          complete: false,
          error: false,
          retry: requestSnapshot,
        }));
        return;
      }

      const code = normalizeChatErrorCode(error);
      if (code === 'SESSION_INVALID' || code === 'ACCESS_REQUIRED') {
        setAccessState('locked');
        setExpiresAt(null);
        setRemainingMessages(0);
        clearConversation();
      } else if (code === 'CONVERSATION_INVALID' || code === 'CONVERSATION_MODE_MISMATCH') {
        setConversationId(null);
      }
      updateAssistant(assistantId, (assistant) => ({
        ...assistant,
        error: true,
        sources: [],
        text: publicErrorMessage(code),
        retry: isRecoverableChatError(code) ? requestSnapshot : undefined,
        complete: false,
        stopped: false,
      }));
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setStreaming(false);
      setPhase((current) => current === 'handoff' ? current : null);
    }
  }

  function sendCurrent() {
    const snapshot = currentSnapshot();
    if (snapshot) void sendSnapshot(snapshot);
  }

  function sendStarter(input: {
    mode: ChatMode;
    audienceIntent: ChatAudienceIntent;
    prompt: string;
  }) {
    if (streaming || abortControllerRef.current) return;
    setMode(input.mode);
    setAudienceIntent(input.audienceIntent);
    void sendSnapshot({
      workflow: 'chat',
      mode: input.mode,
      audienceIntent: input.audienceIntent,
      turnId: crypto.randomUUID(),
      displayText: input.prompt,
      message: input.prompt,
    });
  }

  function retry(retryAssistantId: string, requestSnapshot: ChatRequestSnapshot) {
    void sendSnapshot(requestSnapshot, retryAssistantId);
  }

  function stop() {
    abortControllerRef.current?.abort();
  }

  async function unlock() {
    setAccessError('');
    try {
      const response = await fetch('/api/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inviteCode }),
      });
      const data = await response.json() as {
        ok?: boolean;
        expiresAt?: string;
        remainingMessages?: number;
      };
      if (!response.ok || !data.ok) {
        setAccessError('邀请码无效或已过期，请检查后重试。');
        return;
      }
      setExpiresAt(data.expiresAt ?? null);
      setRemainingMessages(data.remainingMessages ?? 0);
      setInviteCode('');
      setHistoryLoading(true);
      setAccessState('authorized');
    } catch {
      setAccessError('暂时无法验证邀请码，请稍后重试。');
    }
  }

  async function logout() {
    stop();
    await fetch('/api/access', { method: 'DELETE' }).catch(() => undefined);
    setAccessState('locked');
    setExpiresAt(null);
    setRemainingMessages(0);
    setHistoryLoading(false);
    setWorkflowState('chat');
    setMode('general');
    setAudienceIntent('general');
    setDraft('');
    setJobDescription('');
    setDiagnosis(emptyDiagnosis);
    clearConversation();
  }

  return {
    accessState,
    inviteCode,
    setInviteCode,
    accessError,
    historyError,
    historyLoading,
    expiresAt,
    remainingMessages,
    workflow,
    setWorkflow,
    mode,
    audienceIntent,
    sendStarter,
    messages,
    draft,
    setDraft,
    jobDescription,
    setJobDescription,
    diagnosis,
    setDiagnosis,
    diagnosisStatus,
    phase,
    streaming,
    unlock,
    logout,
    sendCurrent,
    retry,
    stop,
  };
}

export type MorseChatController = ReturnType<typeof useMorseChat>;
