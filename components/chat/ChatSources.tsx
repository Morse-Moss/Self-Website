import {
  extractCitationIndexes,
  sourceAnchorId,
} from '@/lib/client/chat-message-format';
import type { ChatSource } from '@/lib/contracts/chat';

import styles from '../MorseChat.module.css';

interface IndexedSource {
  source: ChatSource;
  citationIndex: number;
}

function SourceList({
  messageId,
  sources,
  external,
}: {
  messageId: string;
  sources: IndexedSource[];
  external: boolean;
}) {
  return (
    <ol className={styles.sources}>
      {sources.map(({ source, citationIndex }) => (
        <li
          id={sourceAnchorId(messageId, citationIndex)}
          key={`${source.kind}-${source.id}-${citationIndex}`}
        >
          <a
            href={source.href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
          >
            <span className={styles.sourceDetails}>
              <strong>{source.title}</strong>
              <small>{external ? `联网资料 · ${source.domain}` : '站内已审核公开知识'}</small>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function ChatSources({
  answerText,
  messageId,
  sources,
}: {
  answerText: string;
  messageId: string;
  sources: ChatSource[];
}) {
  const citedIndexes = new Set(extractCitationIndexes(answerText, sources.length));
  const indexedSources = sources
    .map((source, index) => ({ source, citationIndex: index + 1 }))
    .filter(({ citationIndex }) => citedIndexes.has(citationIndex));
  const localSources = indexedSources.filter(({ source }) => source.kind === 'local');
  const webSources = indexedSources.filter(({ source }) => source.kind !== 'local');
  if (indexedSources.length === 0) return null;

  return (
    <div className={styles.sourceGroups} aria-label="回答来源">
      {localSources.length ? (
        <section className={styles.sourceGroup} data-source-group="local">
          <h4>站内公开资料</h4>
          <SourceList messageId={messageId} sources={localSources} external={false} />
        </section>
      ) : null}
      {webSources.length ? (
        <section className={styles.sourceGroup} data-source-group="web">
          <h4>联网参考资料</h4>
          <SourceList messageId={messageId} sources={webSources} external />
        </section>
      ) : null}
    </div>
  );
}
