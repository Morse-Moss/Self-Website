import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeTurnMessage, encodeTurnMessage } from '../lib/server/turn-codec.ts';

test('turn codec round-trips ids, text, and validated sources', () => {
  const legacySources = [{
    documentId: 'project-deep-research',
    title: 'Deep Research',
    href: '/works/deep-research',
    score: 0.91,
    sourcePath: 'content/private.json',
  }];

  const encoded = encodeTurnMessage('turn-1', 'answer', legacySources);
  const decoded = decodeTurnMessage(encoded);

  assert.deepEqual(decoded, {
    turnId: 'turn-1',
    content: 'answer',
    sources: [{
      id: 'project-deep-research',
      title: 'Deep Research',
      href: '/works/deep-research',
      kind: 'local',
      domain: null,
      score: 0.91,
    }],
  });
  assert.doesNotMatch(encoded, /documentId|sourcePath|private\.json/);
});

test('turn codec round-trips public web citations with null score and strips private fields', () => {
  const publicSource = {
    id: 'web-123',
    title: 'External docs',
    href: 'https://example.com/docs',
    kind: 'web' as const,
    domain: 'example.com',
    score: null,
    documentId: 'must-not-survive',
    snippet: 'private prompt context',
    raw: { secret: true },
    sourcePath: '/private/path',
  };
  const encoded = encodeTurnMessage('turn-web', 'answer', [publicSource]);
  const decoded = decodeTurnMessage(encoded);

  assert.deepEqual(decoded, {
    turnId: 'turn-web',
    content: 'answer',
    sources: [{
      id: 'web-123',
      title: 'External docs',
      href: 'https://example.com/docs',
      kind: 'web',
      domain: 'example.com',
      score: null,
    }],
  });
  assert.doesNotMatch(encoded, /documentId|must-not-survive|private prompt context|private\/path|secret/);
});

test('turn codec canonicalizes new local citations to the exact six public fields', () => {
  const encoded = encodeTurnMessage('turn-local', 'answer', [{
    id: 'local-1',
    title: 'Local source',
    href: '/works#deep-research',
    kind: 'local',
    domain: null,
    score: 0.87,
    documentId: 'private-document-id',
    extra: 'private-extra-field',
  }]);

  assert.deepEqual(decodeTurnMessage(encoded).sources, [{
    id: 'local-1',
    title: 'Local source',
    href: '/works#deep-research',
    kind: 'local',
    domain: null,
    score: 0.87,
  }]);
  assert.doesNotMatch(encoded, /documentId|private-document-id|extra|private-extra-field/);
});

test('turn codec treats legacy and malformed envelopes as plain text', () => {
  assert.deepEqual(decodeTurnMessage('legacy plain text'), {
    turnId: null,
    content: 'legacy plain text',
    sources: null,
  });
  assert.deepEqual(decodeTurnMessage('morse-turn-v1:{bad json}'), {
    turnId: null,
    content: 'morse-turn-v1:{bad json}',
    sources: null,
  });
  assert.deepEqual(decodeTurnMessage(
    'morse-turn-v1:{"turnId":"turn-1","content":"answer","sources":[{"href":1}]}',
  ), {
    turnId: 'turn-1',
    content: 'answer',
    sources: null,
  });
});

test('turn codec rejects unsafe public citation URLs and mismatched domains', () => {
  for (const source of [{
    id: 'web-script',
    title: 'Unsafe',
    href: 'javascript:alert(1)',
    kind: 'web' as const,
    domain: 'example.com',
    score: null,
  }, {
    id: 'web-domain',
    title: 'Mismatched',
    href: 'https://evil.example/docs',
    kind: 'official' as const,
    domain: 'openai.com',
    score: null,
  }]) {
    const decoded = decodeTurnMessage(encodeTurnMessage('turn-unsafe', 'answer', [source]));
    assert.equal(decoded.sources, null);
  }
});

test('turn codec rejects single-label and reserved-suffix public citation URLs', () => {
  for (const href of [
    'https://printer/status',
    'https://service.local/status',
    'https://service.localdomain/status',
    'https://service.lan/status',
    'https://service.home.arpa/status',
    'https://service.test/status',
    'https://service.invalid/status',
    'https://service.example/status',
    'https://service.onion/status',
  ]) {
    const source = {
      id: 'web-unsafe',
      title: 'Unsafe',
      href,
      kind: 'web' as const,
      domain: new URL(href).hostname,
      score: null,
    };
    assert.equal(
      decodeTurnMessage(encodeTurnMessage('turn-unsafe', 'answer', [source])).sources,
      null,
      href,
    );
  }
});
