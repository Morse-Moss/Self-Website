import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadPreviousRouteAnchor,
  loadRecordedInteractionRoute,
} from '../lib/server/interaction-log.ts';
import { SAFETY_BOUNDARY_REPLY } from '../lib/server/chat-route-policy.ts';

test('loadPreviousRouteAnchor preserves a routed follow-up as the current anchor', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          inherited_from_turn_id: '00000000-0000-4000-8000-000000000000',
          route_kind: 'grounded',
          route_reason_code: 'anaphoric_project_followup',
          topic_kind: 'project',
          topic_ref: 'digital-morse',
        }],
      };
    },
  };

  const anchor = await loadPreviousRouteAnchor(
    client,
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
  );

  assert.deepEqual(anchor, {
    turnId: '11111111-1111-4111-8111-111111111111',
    routeKind: 'grounded',
    reasonCode: 'anaphoric_project_followup',
    topicKind: 'project',
    topicRef: 'digital-morse',
  });
  assert.match(queries[0] ?? '', /route_reason_code/u);
});

test('loadRecordedInteractionRoute preserves a recorded safety boundary reply', async () => {
  const client = {
    async query() {
      return {
        rows: [{
          route_kind: 'clarify',
          route_reason_code: 'unsafe_or_unverifiable_request',
          topic_kind: 'none',
          topic_ref: null,
          evidence_class: 'none',
          inherited_from_turn_id: null,
        }],
      };
    },
  };

  const route = await loadRecordedInteractionRoute(
    client,
    '44444444-4444-4444-8444-444444444444',
  );

  assert.equal(route?.deterministicReply, SAFETY_BOUNDARY_REPLY);
});
