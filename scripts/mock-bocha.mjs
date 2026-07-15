import http from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 64 * 1024;

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request_too_large'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, value) {
  if (response.destroyed) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function mockResults(query) {
  return [
    {
      id: 'mock-web-1',
      name: 'OpenAI API documentation',
      url: 'https://platform.openai.com/docs',
      snippet: `Mock external evidence for: ${query}`,
      summary: 'Mock result used only for deterministic local acceptance.',
    },
    {
      id: 'mock-web-2',
      name: 'Revolution repository',
      url: 'https://github.com/Morse-Moss/Self-Website',
      snippet: 'Mock GitHub result for citation classification.',
      summary: '',
    },
  ];
}

export function createMockBochaServer({
  apiKey = 'mock-bocha-key',
  failFirst = false,
} = {}) {
  let requests = 0;
  return http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/web-search') {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      sendJson(response, 401, { error: 'unauthorized' });
      return;
    }

    try {
      const body = await readJson(request);
      if (
        typeof body.query !== 'string'
        || !body.query.trim()
        || body.summary !== true
        || body.count !== 5
      ) {
        sendJson(response, 400, { error: 'invalid_request' });
        return;
      }
      requests += 1;
      if (failFirst && requests === 1) {
        sendJson(response, 503, { error: 'temporary_unavailable' });
        return;
      }
      sendJson(response, 200, {
        queryContext: { originalQuery: body.query.trim() },
        webPages: { value: mockResults(body.query.trim()) },
      });
    } catch {
      sendJson(response, 400, { error: 'invalid_request' });
    }
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const port = Number(process.env.MORSE_MOCK_BOCHA_PORT || 18092);
  const server = createMockBochaServer({
    apiKey: process.env.MORSE_MOCK_BOCHA_KEY || 'mock-bocha-key',
    failFirst: process.env.MORSE_MOCK_BOCHA_FAIL_FIRST === 'true',
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Mock Bocha listening on http://127.0.0.1:${port}/v1`);
  });
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
