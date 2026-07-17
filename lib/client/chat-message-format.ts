export type ChatInlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'citation'; index: number };

export type ChatMessageBlock =
  | { kind: 'paragraph'; content: string }
  | { kind: 'section'; content: string }
  | { kind: 'divider' }
  | { kind: 'unordered-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] };

const inlinePattern = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`|\[来源\d+\])/gu;
const citationPattern = /\[来源(\d+)\]/gu;

export function parseChatInline(value: string): ChatInlineToken[] {
  const tokens: ChatInlineToken[] = [];
  let cursor = 0;

  for (const match of value.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: 'text', value: value.slice(cursor, index) });

    const token = match[0];
    const citation = /^\[来源(\d+)\]$/u.exec(token);
    if (citation) {
      tokens.push({ kind: 'citation', index: Number(citation[1]) });
    } else if (token.startsWith('`')) {
      tokens.push({ kind: 'code', value: token.slice(1, -1) });
    } else {
      tokens.push({ kind: 'strong', value: token.slice(2, -2) });
    }
    cursor = index + token.length;
  }

  if (cursor < value.length) tokens.push({ kind: 'text', value: value.slice(cursor) });
  return tokens;
}

export function parseChatMessageBlocks(value: string): ChatMessageBlock[] {
  const lines = value.replaceAll('\r\n', '\n').trim().split('\n');
  if (lines.length === 1 && !lines[0]) return [];

  const blocks: ChatMessageBlock[] = [];
  let paragraph: string[] = [];
  let listKind: 'unordered-list' | 'ordered-list' | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'paragraph', content: paragraph.join(' ').trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (!listKind || !listItems.length) return;
    blocks.push({ kind: listKind, items: listItems });
    listKind = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/u.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'divider' });
      continue;
    }

    const section = /^(?:\*\*|__)(.+?)(?:\*\*|__)$/u.exec(line);
    const heading = /^#{1,3}\s+(.+)$/u.exec(line);
    if (section || heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'section', content: (section?.[1] ?? heading?.[1] ?? '').trim() });
      continue;
    }

    const unordered = /^[-+*]\s+(.+)$/u.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/u.exec(line);
    const nextListKind = unordered ? 'unordered-list' : ordered ? 'ordered-list' : null;
    if (nextListKind) {
      flushParagraph();
      if (listKind && listKind !== nextListKind) flushList();
      listKind = nextListKind;
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? '').trim());
      continue;
    }

    if (listKind && /^\s{2,}\S/u.test(rawLine) && listItems.length) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${line}`;
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function extractCitationIndexes(value: string, sourceCount: number): number[] {
  const indexes: number[] = [];
  const seen = new Set<number>();
  for (const match of value.matchAll(citationPattern)) {
    const index = Number(match[1]);
    if (index < 1 || index > sourceCount || seen.has(index)) continue;
    seen.add(index);
    indexes.push(index);
  }
  return indexes;
}

export function sourceAnchorId(messageId: string, citationIndex: number): string {
  return `morse-source-${messageId.replace(/[^a-z0-9_-]/giu, '-')}-${citationIndex}`;
}
