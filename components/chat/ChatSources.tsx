import type { ChatSource } from './useMorseChat';

import styles from '../MorseChat.module.css';

interface IndexedSource {
  source: ChatSource;
  citationIndex: number;
}

function SourceList({ sources, external }: { sources: IndexedSource[]; external: boolean }) {
  return (
    <ol className={styles.sources}>
      {sources.map(({ source, citationIndex }) => (
        <li key={`${source.kind}-${source.id}-${citationIndex}`}>
          <a
            href={source.href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
          >
            <span>[{citationIndex}]</span>
            <span>{source.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export default function ChatSources({ sources }: { sources: ChatSource[] }) {
  const indexedSources = sources.map((source, index) => ({ source, citationIndex: index + 1 }));
  const localSources = indexedSources.filter(({ source }) => source.kind === 'local');
  const webSources = indexedSources.filter(({ source }) => source.kind !== 'local');
  if (sources.length === 0) return null;

  return (
    <div className={styles.sourceGroups} aria-label="回答来源">
      {localSources.length ? (
        <section className={styles.sourceGroup} data-source-group="local">
          <h4>站内来源</h4>
          <SourceList sources={localSources} external={false} />
        </section>
      ) : null}
      {webSources.length ? (
        <section className={styles.sourceGroup} data-source-group="web">
          <h4>联网来源</h4>
          <SourceList sources={webSources} external />
        </section>
      ) : null}
    </div>
  );
}
