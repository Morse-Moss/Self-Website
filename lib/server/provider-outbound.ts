import { promises as dns } from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

export interface ProviderAddress {
  address: string;
  family: 4 | 6;
}

export type ProviderAddressResolver = (
  hostname: string,
) => Promise<ProviderAddress[]>;

export interface ProviderTransportInput {
  address: ProviderAddress;
  body: Uint8Array | null;
  headers: Headers;
  method: string;
  servername: string;
  signal?: AbortSignal;
  url: URL;
}

export type ProviderRequestTransport = (
  input: ProviderTransportInput,
) => Promise<Response>;

export interface ProviderOutboundPolicy {
  allowedLoopbackHttpOrigin: string | null;
}

export class ProviderOutboundError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProviderOutboundError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new ProviderOutboundError(code);
}

export function validateProviderBaseUrl(input: string): URL {
  const url = validateProviderRuntimeBaseUrl(input, { allowedLoopbackHttpOrigin: null });
  if (url.protocol !== 'https:') fail('PROVIDER_URL_INVALID');
  return url;
}

export function validateProviderRuntimeBaseUrl(
  input: string,
  policy: ProviderOutboundPolicy,
): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    fail('PROVIDER_URL_INVALID');
  }
  if (
    url.username
    || url.password
    || url.search
    || url.hash
  ) fail('PROVIDER_URL_INVALID');
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '');
  validateRequestUrl(url, policy);
  return url;
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split('.').map(Number);
  return bytes.length === 4 ? bytes : null;
}

function isPublicIpv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6Words(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(':');
  const ipv4Tail = normalized.slice(lastColon + 1);
  const bytes = ipv4Bytes(ipv4Tail);
  if (bytes) {
    normalized = `${normalized.slice(0, lastColon)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((word) => Number.parseInt(word || '0', 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word))
    ? words
    : null;
}

function isPublicIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (!words) return false;
  const mappedIpv4 = words.slice(0, 5).every((word) => word === 0)
    && words[5] === 0xffff;
  if (mappedIpv4) {
    return isPublicIpv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if ((words[0] & 0xe000) !== 0x2000) return false;
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  if (words[0] === 0x2001 && words[1] === 0x0002) return false;
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0010) return false;
  if (words[0] === 0x2001 && (words[1] & 0xfff0) === 0x0020) return false;
  return true;
}

function isPublicAddress(entry: ProviderAddress): boolean {
  return entry.family === 4
    ? isPublicIpv4(entry.address)
    : isPublicIpv6(entry.address);
}

const defaultResolver: ProviderAddressResolver = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
};

export async function resolvePublicProviderAddresses(
  hostname: string,
  resolver: ProviderAddressResolver = defaultResolver,
): Promise<ProviderAddress[]> {
  let addresses: ProviderAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    fail('PROVIDER_ADDRESS_UNAVAILABLE');
  }
  if (
    addresses.length < 1
    || addresses.some((entry) => !isPublicAddress(entry))
  ) fail('PROVIDER_ADDRESS_DENIED');
  return addresses;
}

function headersFromNode(input: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

const nodeRequestTransport: ProviderRequestTransport = (input) => new Promise((resolve, reject) => {
  const requestFn = input.url.protocol === 'http:' ? http.request : https.request;
  const hostname = input.url.hostname.replace(/^\[|\]$/gu, '');
  const request = requestFn({
    protocol: input.url.protocol,
    hostname,
    port: input.url.port || undefined,
    method: input.method,
    path: `${input.url.pathname}${input.url.search}`,
    headers: Object.fromEntries(input.headers.entries()),
    servername: input.url.protocol === 'https:' ? input.servername : undefined,
    lookup: (_name, options, callback) => {
      if (options.all) {
        callback(null, [input.address]);
        return;
      }
      callback(null, input.address.address, input.address.family);
    },
  }, (response) => {
    resolve(new Response(Readable.toWeb(response) as ReadableStream, {
      status: response.statusCode ?? 502,
      statusText: response.statusMessage,
      headers: headersFromNode(response.headers),
    }));
  });
  const abort = () => request.destroy(input.signal?.reason);
  if (input.signal?.aborted) abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  request.once('error', reject);
  request.once('close', () => input.signal?.removeEventListener('abort', abort));
  if (input.body) request.write(input.body);
  request.end();
});

function validateRequestUrl(url: URL, policy: ProviderOutboundPolicy): void {
  const allowedHttp = url.protocol === 'http:'
    && policy.allowedLoopbackHttpOrigin !== null
    && url.origin === policy.allowedLoopbackHttpOrigin;
  if (
    (url.protocol !== 'https:' && !allowedHttp)
    || url.username
    || url.password
    || url.hash
  ) fail('PROVIDER_URL_INVALID');
}

export function createProviderOutboundPolicy(
  env: Record<string, string | undefined> = process.env,
): ProviderOutboundPolicy {
  const raw = env.MORSE_PROVIDER_MOCK_ORIGIN?.trim();
  if (!raw) return { allowedLoopbackHttpOrigin: null };
  if (env.NODE_ENV === 'production' || env.MORSE_LOCAL_RELEASE_SMOKE !== 'true') {
    fail('PROVIDER_URL_INVALID');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('PROVIDER_URL_INVALID');
  }
  const loopback = url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  if (!loopback) fail('PROVIDER_URL_INVALID');
  return { allowedLoopbackHttpOrigin: url.origin };
}

export function createPinnedProviderFetch(input: {
  policy?: ProviderOutboundPolicy;
  request?: ProviderRequestTransport;
  resolver?: ProviderAddressResolver;
} = {}): typeof fetch {
  const policy = input.policy ?? { allowedLoopbackHttpOrigin: null };
  const requestTransport = input.request ?? nodeRequestTransport;
  const resolver = input.resolver ?? defaultResolver;

  return (async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(resource, init);
    const url = new URL(request.url);
    validateRequestUrl(url, policy);
    const allowedLoopback = url.protocol === 'http:';
    let addresses: ProviderAddress[];
    if (allowedLoopback) {
      addresses = [{
        address: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
        family: url.hostname === '[::1]' ? 6 : 4,
      }];
    } else {
      addresses = await resolvePublicProviderAddresses(url.hostname, resolver);
    }
    if (request.signal.aborted) throw request.signal.reason;
    const body = request.body === null
      ? null
      : new Uint8Array(await request.arrayBuffer());
    if (request.signal.aborted) throw request.signal.reason;
    let response: Response;
    try {
      response = await requestTransport({
        address: addresses[0],
        body,
        headers: request.headers,
        method: request.method,
        servername: url.hostname.replace(/^\[|\]$/gu, ''),
        signal: request.signal,
        url,
      });
    } catch {
      if (request.signal.aborted) throw request.signal.reason;
      fail('PROVIDER_UNAVAILABLE');
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      fail('PROVIDER_REDIRECT_DENIED');
    }
    return response;
  }) as typeof fetch;
}
