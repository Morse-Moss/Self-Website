'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

import {
  isRecoverableChatError,
  normalizeChatErrorCode,
  publicErrorMessage,
} from '@/lib/client/chat-errors';
import { readChatSse, type ChatSsePayload } from '@/lib/client/chat-sse';

import styles from './MorseChat.module.css';

type AccessState = 'checking' | 'locked' | 'authorized';
type ChatMode = 'general' | 'interviewer';
type ChatAudienceIntent = 'general' | 'recruiter' | 'collaboration' | 'peer';
type BudgetLevel = 'normal' | 'notice' | 'warning' | 'critical' | 'exhausted';

interface ChatSource {
  documentId: string;
  title: string;
  href: string;
  score: number;
}

interface ChatRequestSnapshot {
  message: string;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  turnId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: ChatSource[];
  error?: boolean;
  retry?: ChatRequestSnapshot;
  pendingLabel?: string;
  complete?: boolean;
}

interface StreamPayload extends ChatSsePayload {
  conversationId?: string;
  sources?: ChatSource[];
  text?: string;
  code?: string;
  budgetLevel?: BudgetLevel;
  consumed?: boolean;
  remainingMessages?: number;
}

const starterIntents: Array<{
  label: string;
  mode: ChatMode;
  audienceIntent: ChatAudienceIntent;
  prompt: string;
}> = [
  {
    label: '招人的',
    mode: 'interviewer',
    audienceIntent: 'recruiter',
    prompt: '请从招聘方视角介绍最匹配的项目、能力证据和仍需补充的信息。',
  },
  {
    label: '找人做事的',
    mode: 'general',
    audienceIntent: 'collaboration',
    prompt: '我想了解摩斯会如何分析并推进一个 AI 系统需求。',
  },
  {
    label: '同行交流',
    mode: 'general',
    audienceIntent: 'peer',
    prompt: '请介绍摩斯在 Agent、RAG 和多 Agent 系统上的关键工程判断。',
  },
];

function budgetMessage(level: BudgetLevel): string {
  if (level === 'notice') return '本月对话额度已使用过半。';
  if (level === 'warning') return '本月对话额度已接近上限。';
  if (level === 'critical') return '本月对话额度即将用完。';
  if (level === 'exhausted') return '本月对话额度已用完。';
  return '';
}

export default function MorseChat() {
  const [open, setOpen] = useState(false);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [inviteCode, setInviteCode] = useState('');
  const [accessError, setAccessError] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remainingMessages, setRemainingMessages] = useState(0);
  const [mode, setMode] = useState<ChatMode>('general');
  const [audienceIntent, setAudienceIntent] = useState<ChatAudienceIntent>('general');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [budgetLevel, setBudgetLevel] = useState<BudgetLevel>('normal');
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('morse-chat:open', handleOpen);
    return () => window.removeEventListener('morse-chat:open', handleOpen);
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/access', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { authorized?: boolean; expiresAt?: string | null; remainingMessages?: number }) => {
        if (!active) return;
        setAccessState(data.authorized ? 'authorized' : 'locked');
        setExpiresAt(data.expiresAt ?? null);
        setRemainingMessages(data.remainingMessages ?? 0);
      })
      .catch(() => active && setAccessState('locked'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.add('morse-chat-open');
    return () => document.documentElement.classList.remove('morse-chat-open');
  }, [open]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        error?: string;
      };
      if (!response.ok || !data.ok) {
        setAccessError('邀请码无效或已过期,请检查后重试。');
        return;
      }

      setAccessState('authorized');
      setExpiresAt(data.expiresAt ?? null);
      setRemainingMessages(data.remainingMessages ?? 0);
      setInviteCode('');
    } catch {
      setAccessError('暂时无法验证邀请码,请稍后重试。');
    }
  }

  function updateAssistant(id: string, update: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => current.map((message) => (
      message.id === id ? update(message) : message
    )));
  }

  async function sendMessage(
    text: string,
    retryAssistantId?: string,
    retrySnapshot?: ChatRequestSnapshot,
  ) {
    const message = (retrySnapshot?.message ?? text).trim();
    if (!message || streaming) return;

    const requestSnapshot: ChatRequestSnapshot = retrySnapshot ?? {
      message,
      mode,
      audienceIntent,
      turnId: crypto.randomUUID(),
    };
    const assistantId = retryAssistantId ? retryAssistantId : crypto.randomUUID();
    if (retryAssistantId) {
      updateAssistant(assistantId, (assistant) => ({
        ...assistant,
        text: '',
        sources: [],
        error: false,
        retry: undefined,
        pendingLabel: '正在检索公开知识...',
        complete: false,
      }));
    } else {
      const userId = crypto.randomUUID();
      setMessages((current) => [
        ...current,
        { id: userId, role: 'user', text: message },
        {
          id: assistantId,
          role: 'assistant',
          text: '',
          pendingLabel: '正在检索公开知识...',
        },
      ]);
      setDraft('');
    }
    setStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestSnapshot, conversationId }),
      });
      if (response.status === 401) {
        setAccessState('locked');
        throw new Error('ACCESS_REQUIRED');
      }
      if (!response.ok) throw new Error('CHAT_UNAVAILABLE');

      await readChatSse<StreamPayload>(response, (event, payload) => {
        if (event === 'meta') {
          setConversationId(payload.conversationId ?? null);
          if (payload.budgetLevel) setBudgetLevel(payload.budgetLevel);
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            sources: payload.sources ?? [],
            pendingLabel: '正在组织回答...',
          }));
        } else if (event === 'delta') {
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            text: assistant.text + (payload.text ?? ''),
            pendingLabel: undefined,
          }));
        } else if (event === 'done') {
          if (payload.budgetLevel) setBudgetLevel(payload.budgetLevel);
          if (typeof payload.remainingMessages === 'number') {
            setRemainingMessages(payload.remainingMessages);
          }
          updateAssistant(assistantId, (assistant) => ({
            ...assistant,
            pendingLabel: undefined,
            retry: undefined,
            complete: true,
          }));
        }
      });
    } catch (error) {
      const code = normalizeChatErrorCode(error);
      if (code === 'SESSION_INVALID' || code === 'ACCESS_REQUIRED') {
        setAccessState('locked');
        setConversationId(null);
        setMessages([]);
        setRemainingMessages(0);
        setMode('general');
        setAudienceIntent('general');
        setBudgetLevel('normal');
      } else if (code === 'CONVERSATION_INVALID' || code === 'CONVERSATION_MODE_MISMATCH') {
        setConversationId(null);
      }
      updateAssistant(assistantId, (assistant) => ({
        ...assistant,
        error: true,
        sources: [],
        text: publicErrorMessage(code),
        pendingLabel: undefined,
        retry: isRecoverableChatError(code) ? requestSnapshot : undefined,
        complete: false,
      }));
    } finally {
      setStreaming(false);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function changeMode(nextMode: ChatMode) {
    const nextIntent: ChatAudienceIntent = nextMode === 'interviewer' ? 'recruiter' : 'general';
    if (streaming || (mode === nextMode && audienceIntent === nextIntent)) return;
    setMode(nextMode);
    setAudienceIntent(nextIntent);
    setConversationId(null);
    setMessages([]);
  }

  async function logout() {
    await fetch('/api/access', { method: 'DELETE' });
    setAccessState('locked');
    setConversationId(null);
    setMessages([]);
    setRemainingMessages(0);
    setMode('general');
    setAudienceIntent('general');
    setBudgetLevel('normal');
  }

  return (
    <div className={styles.root} data-testid="morse-chat">
      {!open ? (
        <button className={styles.launcher} type="button" onClick={() => setOpen(true)}>
          <span className={styles.signal} aria-hidden="true" />
          对话
        </button>
      ) : (
        <section className={styles.panel} role="dialog" aria-label="数字摩斯对话">
          <header className={styles.header}>
            <div>
              <p className={styles.kicker}>DIGITAL MORSE</p>
              <h2 className={styles.title}>数字摩斯</h2>
            </div>
            <button className={styles.closeButton} type="button" onClick={() => setOpen(false)} aria-label="关闭对话">
              ×
            </button>
          </header>

          {accessState === 'checking' ? (
            <div className={styles.centerState} role="status">正在确认访问权限...</div>
          ) : accessState === 'locked' ? (
            <form className={styles.unlock} onSubmit={unlock}>
              <div>
                <p className={styles.kicker}>INVITE ACCESS</p>
                <h3 className={styles.sectionTitle}>输入本次邀请的短期码</h3>
                <p className={styles.supporting}>作品集保持公开,邀请码只解锁实时对话。</p>
              </div>
              <label className={styles.fieldLabel} htmlFor="morse-invite-code">邀请码</label>
              <input
                id="morse-invite-code"
                className={styles.input}
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                autoComplete="one-time-code"
                maxLength={128}
                required
              />
              {accessError ? <p className={styles.errorText} role="alert">{accessError}</p> : null}
              <button className={styles.primaryButton} type="submit">进入对话</button>
            </form>
          ) : (
            <>
              <div className={styles.controlBar}>
                <div className={styles.modeSwitch} aria-label="对话模式">
                  <button
                    type="button"
                    aria-pressed={mode === 'general'}
                    onClick={() => changeMode('general')}
                  >
                    普通对话
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'interviewer'}
                    onClick={() => changeMode('interviewer')}
                  >
                    面试官模式
                  </button>
                </div>
                <span className={styles.quota} data-testid="morse-quota">{remainingMessages} 次</span>
              </div>
              {budgetMessage(budgetLevel) ? (
                <p className={styles.budgetNotice} role="status">{budgetMessage(budgetLevel)}</p>
              ) : null}

              <div className={styles.messages} aria-live="polite">
                {messages.length === 0 ? (
                  <div className={styles.emptyState}>
                    <p>{mode === 'interviewer' ? '可以直接追问项目决策与复盘。' : '想先了解哪一部分?'}</p>
                    <div className={styles.starters}>
                      {starterIntents.map((intent) => (
                        <button
                          key={intent.label}
                          type="button"
                          onClick={() => {
                            setMode(intent.mode);
                            setAudienceIntent(intent.audienceIntent);
                            setDraft(intent.prompt);
                          }}
                        >
                          {intent.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : messages.map((message) => (
                  <article
                    key={message.id}
                    className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}
                    data-error={message.error || undefined}
                    data-stream-state={message.role === 'assistant'
                      ? (message.complete ? 'done' : message.error ? 'error' : 'pending')
                      : undefined}
                  >
                    <span className={styles.messageRole}>{message.role === 'user' ? '你' : '数字摩斯'}</span>
                    <p>{message.text || message.pendingLabel || ''}</p>
                    {message.sources?.length ? (
                      <ol className={styles.sources} aria-label="回答来源">
                        {message.sources.map((source, index) => (
                          <li key={`${message.id}-${source.documentId}-${index}`}>
                            <a href={source.href}>
                              <span>[{index + 1}]</span> {source.title}
                            </a>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                    {message.error && message.retry ? (
                      <button
                        className={styles.retryButton}
                        type="button"
                        disabled={streaming}
                        onClick={() => {
                          if (message.retry) {
                            void sendMessage(message.retry.message, message.id, message.retry);
                          }
                        }}
                      >
                        重试本次问题
                      </button>
                    ) : null}
                  </article>
                ))}
                <div ref={messageEndRef} />
              </div>

              <form className={styles.composer} onSubmit={submitMessage}>
                <label className={styles.srOnly} htmlFor="morse-message">输入问题</label>
                <textarea
                  id="morse-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="问项目、经历或技术决策"
                  maxLength={500}
                  rows={2}
                  disabled={streaming}
                />
                <button type="submit" disabled={streaming || !draft.trim()}>发送</button>
              </form>

              <footer className={styles.sessionFooter}>
                <span>{expiresAt ? `有效至 ${new Date(expiresAt).toLocaleString('zh-CN')}` : '短期会话'}</span>
                <button type="button" onClick={() => void logout()}>退出会话</button>
              </footer>
            </>
          )}
        </section>
      )}
    </div>
  );
}
