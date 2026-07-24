import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptV2Route } from '../lib/server/chat-service.ts';

test('v2 route adaptation leaves reasoning effort to the active model preset', () => {
  for (const routeKind of ['conversation', 'jd'] as const) {
    const route = adaptV2Route({
      routeKind,
      reasonCode: 'test_route',
      topicKind: routeKind === 'jd' ? 'jd' : 'none',
      topicRef: routeKind === 'jd' ? 'jd' : null,
      evidenceClass: routeKind === 'jd' ? 'mixed' : 'none',
      inheritedFromTurnId: null,
      release: routeKind === 'jd' ? 'complete' : 'segment',
      requiresEmbedding: routeKind === 'jd',
      requiresSearch: false,
      deterministicReply: null,
    });

    assert.equal(route.reasoningEffort, undefined, routeKind);
  }
});
