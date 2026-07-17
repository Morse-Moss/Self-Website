import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { MAX_SEARCH_RESULTS, type SearchResult, type SearchSourceKind } from './search-provider.ts';

export interface SearchTrustConfig {
  officialDomains: string[];
  githubOwners: string[];
}

interface RawSearchCandidate {
  name?: unknown;
  url?: unknown;
  snippet?: unknown;
  summary?: unknown;
}

const metadataHostnames = new Set([
  '169.254.169.254',
  'metadata',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
]);

const nonPublicDnsSuffixes = [
  'local',
  'localdomain',
  'lan',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'onion',
];

function cleanHostname(value: string): string {
  const unwrapped = value.startsWith('[') && value.endsWith(']')
    ? value.slice(1, -1)
    : value;
  return unwrapped.toLowerCase().replace(/\.$/, '');
}

function isNonPublicIpv4(hostname: string): boolean {
  const [a, b] = hostname.split('.').map(Number);
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88)
    || (a === 198 && b === 51)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 203 && b === 0)
    || a >= 224;
}

function expandIpv6(hostname: string): number[] | null {
  const address = hostname.toLowerCase();
  if (address.includes('.')) return null;
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const values = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((part) => Number.parseInt(part || '0', 16));
  return values.length === 8 && values.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
    ? values
    : null;
}

function isNonPublicIpv6(hostname: string): boolean {
  const parts = expandIpv6(hostname);
  if (!parts) return true;
  const [first, second] = parts;
  const unspecified = parts.every((part) => part === 0);
  const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  return unspecified
    || loopback
    || ipv4Mapped
    || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xffc0) === 0xfec0
    || (first & 0xff00) === 0xff00
    || (first === 0x2001 && second === 0x0db8);
}

function isForbiddenHostname(hostname: string): boolean {
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.internal')
    || metadataHostnames.has(hostname)
  ) return true;
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isNonPublicIpv4(hostname);
  if (ipVersion === 6) return isNonPublicIpv6(hostname);
  if (!hostname.includes('.')) return true;
  return nonPublicDnsSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

export function normalizePublicHttpsUrl(value: string): string | null {
  try {
    const trimmed = value.trim();
    if (trimmed.length > 2048) return null;
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hostname = cleanHostname(url.hostname);
    if (!hostname || isForbiddenHostname(hostname)) return null;
    url.hostname = hostname;
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch {
    return null;
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  const trusted = cleanHostname(domain);
  return hostname === trusted || hostname.endsWith(`.${trusted}`);
}

export function classifySearchSource(
  value: string,
  config: SearchTrustConfig,
  _title?: string,
): { kind: SearchSourceKind; domain: string } | null {
  const normalized = normalizePublicHttpsUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const domain = cleanHostname(url.hostname);
  if (config.officialDomains.some((trusted) => matchesDomain(domain, trusted))) {
    return { kind: 'official', domain };
  }
  if (domain === 'github.com') {
    const ownerSegment = url.pathname.split('/').filter(Boolean)[0];
    let owner = '';
    try {
      owner = decodeURIComponent(ownerSegment ?? '');
    } catch {
      owner = '';
    }
    if (config.githubOwners.some((trusted) => trusted.toLowerCase() === owner.toLowerCase())) {
      return { kind: 'github', domain };
    }
  }
  return { kind: 'web', domain };
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function citationId(href: string): string {
  return `web-${createHash('sha256').update(href).digest('hex').slice(0, 16)}`;
}

export function sanitizeSearchCandidates(
  candidates: unknown[],
  config: SearchTrustConfig,
): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (!raw || typeof raw !== 'object') continue;
    const candidate = raw as RawSearchCandidate;
    if (typeof candidate.url !== 'string') continue;
    const href = normalizePublicHttpsUrl(candidate.url);
    if (!href || seen.has(href)) continue;
    const classification = classifySearchSource(href, config);
    if (!classification) continue;
    const title = sanitizeText(candidate.name, 200) || classification.domain;
    const summary = sanitizeText(candidate.summary, 1200);
    const snippet = summary || sanitizeText(candidate.snippet, 1200);
    seen.add(href);
    results.push({
      id: citationId(href),
      title,
      href,
      kind: classification.kind,
      domain: classification.domain,
      score: null,
      snippet,
    });
    if (results.length === MAX_SEARCH_RESULTS) break;
  }
  return results;
}

export function parseStoredSearchResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) return [];
  const results: SearchResult[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const stored = raw as Record<string, unknown>;
    if (
      typeof stored.id !== 'string'
      || !/^[a-z0-9_-]{1,80}$/iu.test(stored.id)
      || typeof stored.title !== 'string'
      || typeof stored.href !== 'string'
      || (stored.kind !== 'official' && stored.kind !== 'github' && stored.kind !== 'web')
      || typeof stored.domain !== 'string'
      || stored.score !== null
      || typeof stored.snippet !== 'string'
    ) continue;
    const href = normalizePublicHttpsUrl(stored.href);
    if (!href) continue;
    const domain = cleanHostname(new URL(href).hostname);
    if (domain !== cleanHostname(stored.domain)) continue;
    const title = sanitizeText(stored.title, 200);
    if (!title) continue;
    results.push({
      id: stored.id,
      title,
      href,
      kind: stored.kind,
      domain,
      score: null,
      snippet: sanitizeText(stored.snippet, 1200),
    });
    if (results.length === MAX_SEARCH_RESULTS) break;
  }
  return results;
}
