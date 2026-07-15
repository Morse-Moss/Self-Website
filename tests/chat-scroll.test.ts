import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadScrollHelper() {
  try {
    return await import('../lib/client/chat-scroll.ts');
  } catch (error) {
    assert.fail(`chat scroll helper is missing: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test('isNearChatBottom follows only when the reader remains close to the bottom', async () => {
  const { isNearChatBottom } = await loadScrollHelper();

  assert.equal(isNearChatBottom({ scrollTop: 468, scrollHeight: 1000, clientHeight: 500 }), true);
  assert.equal(isNearChatBottom({ scrollTop: 400, scrollHeight: 1000, clientHeight: 500 }), false);
  assert.equal(isNearChatBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 }), true);
});
