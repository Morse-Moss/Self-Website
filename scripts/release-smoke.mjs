import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const requiredHeaders = new Map([
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['x-frame-options', 'DENY'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
]);

function releaseBaseUrl(value) {
  const candidate = value?.trim() || 'http://127.0.0.1:3000';
  const url = new URL(candidate);
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    (!loopback && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('RELEASE_BASE_URL_INVALID');
  }
  return url;
}

async function fetchChecked(url, fetcher) {
  const response = await fetcher(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error('RELEASE_HTTP_FAILED');
  return response;
}

export async function runReleaseSmoke({
  baseUrl = process.env.MORSE_RELEASE_BASE_URL,
  fetcher = fetch,
} = {}) {
  const target = releaseBaseUrl(baseUrl);
  for (const pathname of ['/api/health/live', '/api/health/ready']) {
    const response = await fetchChecked(new URL(pathname, target), fetcher);
    const payload = await response.json();
    if (
      !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
      || Object.keys(payload).length !== 1
      || payload.ok !== true
    ) {
      throw new Error('RELEASE_HEALTH_CONTRACT_FAILED');
    }
  }
  const root = await fetchChecked(target, fetcher);
  if (root.headers.has('x-powered-by')) throw new Error('RELEASE_HEADER_FAILED');
  for (const [name, value] of requiredHeaders) {
    if (root.headers.get(name) !== value) throw new Error('RELEASE_HEADER_FAILED');
  }
  return { ok: true };
}

export async function main({ logger = console } = {}) {
  const result = await runReleaseSmoke();
  logger.log(JSON.stringify(result));
  return result;
}

const filename = fileURLToPath(import.meta.url);
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === filename;
if (isMain) {
  main().catch(() => {
    console.error('RELEASE_SMOKE_FAILED');
    process.exitCode = 1;
  });
}
