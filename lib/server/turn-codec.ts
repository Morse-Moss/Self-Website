import { normalizePublicHttpsUrl } from './search-safety.ts';

export type TurnSourceKind = 'local' | 'official' | 'github' | 'web';

export interface TurnSource {
  id: string;
  title: string;
  href: string;
  kind: TurnSourceKind;
  domain: string | null;
  score: number | null;
}

export interface DecodedTurnMessage {
  turnId: string | null;
  content: string;
  sources: TurnSource[] | null;
}

const STORED_MESSAGE_PREFIX = 'morse-turn-v1:';
const publicKinds = new Set<TurnSourceKind>(['local', 'official', 'github', 'web']);

function sanitizeTurnSource(value: unknown): TurnSource | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.title !== 'string'
    || !source.title.trim()
    || source.title.length > 200
    || typeof source.href !== 'string'
  ) return null;

  const localHref = source.href.startsWith('/')
    && !source.href.startsWith('//')
    && source.href.length <= 2048;

  const legacyLocal = (
    typeof source.documentId === 'string'
    && source.id === undefined
    && source.kind === undefined
    && source.domain === undefined
  );
  const id = legacyLocal ? source.documentId : source.id;
  const kind = legacyLocal ? 'local' : source.kind;
  const domain = legacyLocal ? null : source.domain;

  if (
    typeof id !== 'string'
    || !/^[a-z0-9_-]{1,80}$/iu.test(id)
    || typeof kind !== 'string'
    || !publicKinds.has(kind as TurnSourceKind)
    || (typeof domain !== 'string' && domain !== null)
  ) return null;
  const sourceKind = kind as TurnSourceKind;
  let href = source.href;
  let publicDomain = domain as string | null;
  if (sourceKind === 'local') {
    if (
      typeof source.score !== 'number'
      || !Number.isFinite(source.score)
      || publicDomain !== null
      || !localHref
    ) return null;
  } else {
    if (source.score !== null || typeof publicDomain !== 'string') return null;
    const normalized = normalizePublicHttpsUrl(source.href);
    if (!normalized) return null;
    const hostname = new URL(normalized).hostname.toLowerCase().replace(/\.$/u, '');
    if (hostname !== publicDomain.toLowerCase().replace(/\.$/u, '')) return null;
    if (sourceKind === 'github' && hostname !== 'github.com') return null;
    href = normalized;
    publicDomain = hostname;
  }

  return {
    id,
    title: source.title,
    href,
    kind: sourceKind,
    domain: publicDomain,
    score: source.score as number | null,
  };
}

export function sanitizeTurnSources(values: unknown): TurnSource[] | null {
  if (!Array.isArray(values)) return null;
  const sources = values.map(sanitizeTurnSource);
  return sources.every((source): source is TurnSource => source !== null) ? sources : null;
}

export function encodeTurnMessage(
  turnId: string,
  content: string,
  sources?: unknown[],
): string {
  const sanitized = sources === undefined ? undefined : sanitizeTurnSources(sources);
  return `${STORED_MESSAGE_PREFIX}${JSON.stringify({ turnId, content, sources: sanitized })}`;
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
      return {
        turnId: parsed.turnId,
        content: parsed.content,
        sources: sanitizeTurnSources(parsed.sources),
      };
    }
  } catch {
    // Malformed envelopes predate the codec contract and remain visible as plain text.
  }

  return { turnId: null, content: value, sources: null };
}
