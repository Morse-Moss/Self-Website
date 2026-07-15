import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeTurnMessage, encodeTurnMessage } from '../lib/server/turn-codec.ts';

test('turn codec round-trips ids, text, and validated sources', () => {
  const sources = [{
    documentId: 'project-deep-research',
    title: 'Deep Research',
    href: '/works/deep-research',
    score: 0.91,
  }];

  const decoded = decodeTurnMessage(encodeTurnMessage('turn-1', 'answer', sources));

  assert.deepEqual(decoded, { turnId: 'turn-1', content: 'answer', sources });
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
