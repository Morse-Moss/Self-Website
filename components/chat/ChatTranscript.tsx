import type { RefObject, UIEvent } from 'react';

import ChatSources from './ChatSources';
import type { ChatMessage, ChatRequestSnapshot } from './useMorseChat';

import styles from '../MorseChat.module.css';

export default function ChatTranscript({
  messages,
  messagesRef,
  onScroll,
  onRetry,
  streaming,
  empty,
}: {
  messages: ChatMessage[];
  messagesRef: RefObject<HTMLDivElement | null>;
  onScroll(event: UIEvent<HTMLDivElement>): void;
  onRetry(assistantId: string, snapshot: ChatRequestSnapshot): void;
  streaming: boolean;
  empty: React.ReactNode;
}) {
  return (
    <div
      ref={messagesRef}
      className={styles.messages}
      data-testid="morse-chat-transcript"
      onScroll={onScroll}
    >
      {messages.length === 0 ? (
        <div className={styles.emptyState}>{empty}</div>
      ) : messages.map((message) => (
        <article
          key={message.id}
          data-message-role={message.role}
          className={message.role === 'user' ? styles.userMessage : styles.assistantMessage}
          data-error={message.error || undefined}
          data-stream-state={message.role === 'assistant'
            ? (message.complete ? 'done' : message.error ? 'error' : message.stopped ? 'stopped' : 'pending')
            : undefined}
        >
          <span className={styles.messageRole}>{message.role === 'user' ? '你' : '数字摩斯'}</span>
          {message.text ? <p>{message.text}</p> : null}
          {message.stopped ? <span className={styles.messageState}>已停止</span> : null}
          {message.diagnosisStatus === 'handoff_pending' ? (
            <span className={styles.messageState}>已进入转交队列</span>
          ) : null}
          <ChatSources sources={message.sources} />
          {message.retry ? (
            <button
              className={styles.retryButton}
              type="button"
              disabled={streaming}
              onClick={() => onRetry(message.id, message.retry!)}
            >
              {message.stopped ? '重新生成' : '重试本次问题'}
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}
