import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodeSse } from '../lib/server/sse.ts';

test('encodeSse creates one standards-compatible event frame', () => {
  assert.equal(
    encodeSse('delta', { text: '你好\n摩斯' }),
    'event: delta\ndata: {"text":"你好\\n摩斯"}\n\n',
  );
});
