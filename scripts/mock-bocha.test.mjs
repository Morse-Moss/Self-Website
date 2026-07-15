import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createMockBochaServer } from './mock-bocha.mjs';

const server = createMockBochaServer({ apiKey: 'mock-test-key' });
let baseUrl = '';

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock address is unavailable.');
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('Mock Bocha enforces the one-shot request and returns the official top-level shape', async () => {
  const response = await fetch(`${baseUrl}/web-search`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer mock-test-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'latest OpenAI API', summary: true, count: 5 }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.webPages.value));
  assert.ok(payload.webPages.value.length <= 5);
  assert.equal('data' in payload, false);
  assert.ok(payload.webPages.value.every((item) => new URL(item.url).protocol === 'https:'));
});

test('Mock Bocha rejects wrong credentials and non-contract bodies', async () => {
  const unauthorized = await fetch(`${baseUrl}/web-search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'latest', summary: true, count: 5 }),
  });
  assert.equal(unauthorized.status, 401);

  const invalid = await fetch(`${baseUrl}/web-search`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer mock-test-key',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: '', summary: true, count: 8 }),
  });
  assert.equal(invalid.status, 400);
});
