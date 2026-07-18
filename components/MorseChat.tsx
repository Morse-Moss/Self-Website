'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';

import { isNearChatBottom } from '@/lib/client/chat-scroll';

import ChatWorkspace from './chat/ChatWorkspace';
import { useMorseChat } from './chat/useMorseChat';
import styles from './MorseChat.module.css';

type MorseChatProps = { variant?: 'overlay' | 'embedded' };

function scrollMessagesToBottom(container: HTMLDivElement | null): boolean {
  if (!container) return false;
  container.scrollTo({
    top: container.scrollHeight,
    behavior: 'auto',
  });
  return true;
}

export default function MorseChat({ variant = 'overlay' }: MorseChatProps) {
  const embedded = variant === 'embedded';
  const [open, setOpen] = useState(embedded);
  const chat = useMorseChat();
  const rootRef = useRef<HTMLDivElement>(null);
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const forceAutoFollowRef = useRef(true);
  const pendingFocusRef = useRef(false);
  const wasStreamingRef = useRef(false);

  function followMessages() {
    if (!scrollMessagesToBottom(messagesRef.current)) return;
    autoFollowRef.current = true;
    forceAutoFollowRef.current = false;
  }

  function focusPendingInput() {
    if (!pendingFocusRef.current || chat.accessState === 'checking' || chat.historyLoading) return;
    const focusTarget = chat.accessState === 'authorized'
      ? messageInputRef.current
      : inviteInputRef.current;
    if (!focusTarget) return;
    focusTarget.focus({ preventScroll: true });
    pendingFocusRef.current = false;
  }

  useEffect(() => {
    let focusFrame = 0;
    const handleOpen = (event: Event) => {
      const prompt = event instanceof CustomEvent
        && typeof event.detail?.prompt === 'string'
        ? event.detail.prompt.trim()
        : '';
      if (prompt) {
        chat.setWorkflow('chat');
        chat.setDraft(prompt);
      }
      pendingFocusRef.current = true;
      forceAutoFollowRef.current = true;
      if (!embedded) {
        setOpen(true);
        followMessages();
        focusFrame = window.requestAnimationFrame(focusPendingInput);
        return;
      }

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      rootRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
      followMessages();
      focusFrame = window.requestAnimationFrame(focusPendingInput);
    };
    window.addEventListener('morse-chat:open', handleOpen);
    return () => {
      window.removeEventListener('morse-chat:open', handleOpen);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [
    chat.accessState,
    chat.historyLoading,
    chat.streaming,
    chat.workflow,
    embedded,
  ]);

  useEffect(() => {
    if (!open || !pendingFocusRef.current || chat.accessState === 'checking' || chat.historyLoading) return;
    const focusFrame = window.requestAnimationFrame(focusPendingInput);
    return () => window.cancelAnimationFrame(focusFrame);
  }, [chat.accessState, chat.historyLoading, open]);

  useEffect(() => {
    if (
      !open
      || (!chat.streaming && !forceAutoFollowRef.current && !autoFollowRef.current)
    ) return;
    followMessages();
  }, [chat.accessState, chat.messages, chat.streaming, open]);

  useEffect(() => {
    const streamSettled = wasStreamingRef.current && !chat.streaming;
    wasStreamingRef.current = chat.streaming;
    if (!streamSettled || !open || chat.accessState !== 'authorized') return;
    const focusFrame = window.requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [chat.accessState, chat.streaming, open]);

  useEffect(() => {
    if (!open || embedded) return;
    document.documentElement.classList.add('morse-chat-open');
    return () => document.documentElement.classList.remove('morse-chat-open');
  }, [embedded, open]);

  function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void chat.unlock();
  }

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${embedded ? styles.embeddedRoot : ''}`}
      data-testid="morse-chat"
      data-variant={variant}
    >
      {!embedded && !open ? (
        <button className={styles.launcher} type="button" onClick={() => setOpen(true)}>
          <span className={styles.signal} aria-hidden="true" />
          对话
        </button>
      ) : open ? (
        <section
          className={`${styles.panel} ${embedded ? styles.embeddedPanel : ''}`}
          data-testid="morse-chat-panel"
          role={embedded ? undefined : 'dialog'}
          aria-label={embedded ? undefined : '数字摩斯对话'}
          aria-labelledby={embedded ? 'morse-chat-title' : undefined}
        >
          <header className={styles.header}>
            <div>
              <p className={styles.kicker}>DIGITAL MORSE</p>
              <h2 className={styles.title} id="morse-chat-title">数字摩斯</h2>
            </div>
            {!embedded ? (
              <button className={styles.closeButton} type="button" onClick={() => setOpen(false)} aria-label="关闭对话">
                ×
              </button>
            ) : null}
          </header>

          {chat.accessState === 'checking' ? (
            <div className={styles.centerState} role="status">正在确认访问权限...</div>
          ) : chat.accessState === 'locked' ? (
            <form className={styles.unlock} onSubmit={submitUnlock}>
              <div>
                <p className={styles.kicker}>INVITE ACCESS</p>
                <h3 className={styles.sectionTitle}>输入本次邀请的短期码</h3>
                <p className={styles.supporting}>作品集保持公开，邀请码只解锁实时对话。</p>
              </div>
              <label className={styles.fieldLabel} htmlFor="morse-invite-code">邀请码</label>
              <input
                ref={inviteInputRef}
                id="morse-invite-code"
                className={styles.input}
                value={chat.inviteCode}
                onChange={(event) => chat.setInviteCode(event.target.value)}
                autoComplete="one-time-code"
                maxLength={128}
                required
              />
              {chat.accessError ? <p className={styles.errorText} role="alert">{chat.accessError}</p> : null}
              <button className={styles.primaryButton} type="submit">进入对话</button>
            </form>
          ) : chat.historyLoading ? (
            <div className={styles.centerState} role="status">正在恢复会话...</div>
          ) : (
            <ChatWorkspace
              chat={chat}
              inputRef={messageInputRef}
              messagesRef={messagesRef}
              onMessagesScroll={(event) => {
                autoFollowRef.current = isNearChatBottom(event.currentTarget);
              }}
            />
          )}
        </section>
      ) : null}
    </div>
  );
}
