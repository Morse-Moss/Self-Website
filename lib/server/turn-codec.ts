export interface TurnSource {
  documentId: string;
  title: string;
  href: string;
  score: number;
}

export interface DecodedTurnMessage {
  turnId: string | null;
  content: string;
  sources: TurnSource[] | null;
}

const STORED_MESSAGE_PREFIX = 'morse-turn-v1:';

function isTurnSource(value: unknown): value is TurnSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.documentId === 'string'
    && typeof source.title === 'string'
    && typeof source.href === 'string'
    && typeof source.score === 'number';
}

export function encodeTurnMessage(
  turnId: string,
  content: string,
  sources?: TurnSource[],
): string {
  return `${STORED_MESSAGE_PREFIX}${JSON.stringify({ turnId, content, sources })}`;
}

export function decodeTurnMessage(value: string): DecodedTurnMessage {
  if (!value.startsWith(STORED_MESSAGE_PREFIX)) {
    return { turnId: null, content: value, sources: null };
  }

  try {
    const parsed = JSON.parse(value.slice(STORED_MESSAGE_PREFIX.length)) as {
      turnId?: unknown;
      content?: unknown;
      sources?: unknown;
    };
    if (typeof parsed.turnId === 'string' && typeof parsed.content === 'string') {
      const sources = Array.isArray(parsed.sources) && parsed.sources.every(isTurnSource)
        ? parsed.sources
        : null;
      return { turnId: parsed.turnId, content: parsed.content, sources };
    }
  } catch {
    // Malformed envelopes predate the codec contract and remain visible as plain text.
  }

  return { turnId: null, content: value, sources: null };
}
