import type { ReactNode } from 'react';

import {
  parseChatInline,
  parseChatMessageBlocks,
} from '@/lib/client/chat-message-format';
import type { ChatSource } from '@/lib/contracts/chat';

import styles from '../MorseChat.module.css';

function renderInline(
  value: string,
  sources: ChatSource[],
): ReactNode[] {
  return parseChatInline(value).map((token, index) => {
    const key = `${token.kind}-${index}`;
    if (token.kind === 'text') return token.value;
    if (token.kind === 'strong') return <strong key={key}>{token.value}</strong>;
    if (token.kind === 'code') return <code key={key}>{token.value}</code>;

    const source = sources[token.index - 1];
    if (!source) {
      return <span key={key} className={styles.missingCitation}>引用资料缺失</span>;
    }
    const navigable = source.kind !== 'local' || source.href !== '/';
    if (!navigable) {
      return (
        <span
          key={key}
          className={styles.citationStatic}
          data-citation-index={token.index}
          data-citation-static="true"
          aria-label={`引用依据：${source.title}`}
        >
          依据：{source.title}
        </span>
      );
    }
    return (
      <a
        key={key}
        className={styles.citationLink}
        href={source.href}
        target="_blank"
        rel="noopener noreferrer"
        data-citation-index={token.index}
        aria-label={`引用依据：${source.title}`}
      >
        依据：{source.title}
      </a>
    );
  });
}

export default function ChatMessageContent({
  sources,
  text,
}: {
  sources: ChatSource[];
  text: string;
}) {
  const blocks = parseChatMessageBlocks(text);

  return (
    <div className={styles.messageContent} data-testid="morse-chat-message-content">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === 'section') {
          return <h3 key={key}>{renderInline(block.content, sources)}</h3>;
        }
        if (block.kind === 'paragraph') {
          return <p key={key}>{renderInline(block.content, sources)}</p>;
        }
        if (block.kind === 'divider') {
          return <hr key={key} className={styles.messageDivider} />;
        }
        const List = block.kind === 'ordered-list' ? 'ol' : 'ul';
        return (
          <List key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{renderInline(item, sources)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
