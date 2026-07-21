import http from 'node:http';

import { createDeterministicTestEmbedding } from '../lib/server/embedding.ts';

const port = Number(process.env.MORSE_MOCK_OPENAI_PORT || 18090);
const failFirstResponse = process.env.MORSE_MOCK_FAIL_FIRST_RESPONSE === 'true';
const expectedApiKey = process.env.MORSE_MOCK_OPENAI_API_KEY?.trim() || null;
const scenario = process.env.MORSE_MOCK_OPENAI_SCENARIO?.trim() || 'success';
const delayMs = Number(process.env.MORSE_MOCK_OPENAI_DELAY_MS || 250);
const scenarios = new Set([
  'success',
  'auth_failure',
  'first_byte_delay',
  'no_output',
  'stream_interrupted',
  'usage_missing',
]);
let responseRequests = 0;

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('MORSE_MOCK_OPENAI_PORT must be a valid TCP port.');
}
if (!scenarios.has(scenario)) {
  throw new Error('MORSE_MOCK_OPENAI_SCENARIO is unsupported.');
}
if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
  throw new Error('MORSE_MOCK_OPENAI_DELAY_MS must be between 0 and 60000.');
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isAuthorized(request) {
  if (scenario === 'auth_failure') return false;
  return !expectedApiKey || request.headers.authorization === `Bearer ${expectedApiKey}`;
}

async function startEventStream(response) {
  if (scenario === 'first_byte_delay') await sleep(delayMs);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
}

function streamEvents(response, events) {
  for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  if (scenario === 'stream_interrupted') {
    setImmediate(() => response.destroy());
    return;
  }
  response.end('data: [DONE]\n\n');
}

function mockUsage(responsesProtocol) {
  if (scenario === 'usage_missing') return undefined;
  return responsesProtocol
    ? { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
    : { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: { message: 'unauthorized' } });
      return;
    }

    if (request.method === 'GET' && request.url === '/v1/models') {
      sendJson(response, 200, {
        object: 'list',
        data: [
          { id: 'gpt-mock-responses', object: 'model', created: 0, owned_by: 'morse-local' },
          { id: 'gpt-mock-chat', object: 'model', created: 0, owned_by: 'morse-local' },
        ],
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/embeddings') {
      const body = await readJson(request);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      sendJson(response, 200, {
        object: 'list',
        model: body.model,
        data: inputs.map((input, index) => ({
          object: 'embedding',
          index,
          embedding: createDeterministicTestEmbedding(String(input)),
        })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/responses') {
      const body = await readJson(request);
      responseRequests += 1;
      if (failFirstResponse && responseRequests === 1) {
        sendJson(response, 503, { error: { message: 'temporary_unavailable' } });
        return;
      }
      await startEventStream(response);
      const webCitationIndex = /<web_search_result index="(\d+)">/u
        .exec(typeof body.instructions === 'string' ? body.instructions : '')?.[1];
      const citations = webCitationIndex ? `[来源1][来源${webCitationIndex}]` : '[来源1]';
      const events = scenario === 'no_output'
        ? []
        : [
            { type: 'response.output_text.delta', delta: '**事实依据：**\n\n- 深度研究系统把证据链作为报告出厂闸门', item_id: 'msg_1', output_index: 0, sequence_number: 1, logprobs: [] },
            { type: 'response.output_text.delta', delta: `。${citations}`, item_id: 'msg_1', output_index: 0, sequence_number: 2, logprobs: [] },
          ];
      if (scenario !== 'stream_interrupted') {
        events.push({
          type: 'response.completed',
          sequence_number: 3,
          response: { usage: mockUsage(true) },
        });
      }
      streamEvents(response, events);
      return;
    }

    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      await readJson(request);
      await startEventStream(response);
      const chunks = scenario === 'no_output'
        ? []
        : [
            {
              id: 'chatcmpl_mock',
              object: 'chat.completion.chunk',
              created: 0,
              model: 'gpt-mock-chat',
              choices: [{ index: 0, delta: { role: 'assistant', content: 'Mock chat answer' }, finish_reason: null }],
            },
          ];
      if (scenario !== 'stream_interrupted') {
        chunks.push({
          id: 'chatcmpl_mock',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'gpt-mock-chat',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: mockUsage(false),
        });
      }
      streamEvents(response, chunks);
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  } catch {
    sendJson(response, 400, { error: 'invalid_request' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock OpenAI listening on http://127.0.0.1:${port}/v1`);
});
