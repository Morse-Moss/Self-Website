import http from 'node:http';

import { createDeterministicTestEmbedding } from '../lib/server/embedding.ts';

const port = Number(process.env.MORSE_MOCK_OPENAI_PORT || 18090);
const failFirstResponse = process.env.MORSE_MOCK_FAIL_FIRST_RESPONSE === 'true';
let responseRequests = 0;

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

const server = http.createServer(async (request, response) => {
  try {
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
      await readJson(request);
      responseRequests += 1;
      if (failFirstResponse && responseRequests === 1) {
        sendJson(response, 503, { error: { message: 'temporary_unavailable' } });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const events = [
        { type: 'response.output_text.delta', delta: '深度研究系统把证据链作为报告出厂闸门', item_id: 'msg_1', output_index: 0, sequence_number: 1, logprobs: [] },
        { type: 'response.output_text.delta', delta: '。[来源1]', item_id: 'msg_1', output_index: 0, sequence_number: 2, logprobs: [] },
        { type: 'response.completed', sequence_number: 3, response: { usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } },
      ];
      for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end('data: [DONE]\n\n');
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
