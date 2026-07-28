import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import {
  loadCanonicalAnswerHistory,
  type LoadCanonicalHistoryInput,
} from '../lib/server/conversation-context-state.ts';
import { encodeTurnMessage } from '../lib/server/turn-codec.ts';

interface QueryBatch {
  rows: Array<Record<string, unknown>>;
}

function queuedClient(...batches: QueryBatch[]) {
  const calls: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  let index = 0;
  return {
    calls,
    client: {
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        const batch = batches[index];
        index += 1;
        if (!batch) throw new Error('Unexpected query');
        return { rows: batch.rows, rowCount: batch.rows.length };
      },
    },
  };
}

function legacyTurnRow(turnId: string, taskId: string | null = null) {
  return {
    turn_id: turnId,
    task_id: taskId,
    context_scope_id: taskId,
    completed_at: new Date('2026-07-28T00:00:00.000Z'),
  };
}

function storedMessage(input: {
  id: string;
  role: 'user' | 'assistant';
  turnId: string;
  text: string;
}) {
  return {
    id: input.id,
    role: input.role,
    content: encodeTurnMessage(input.turnId, input.text),
    created_at: new Date('2026-07-28T00:00:00.000Z'),
  };
}

const conversationId = '11111111-1111-4111-8111-111111111111';

test('legacy V1 and V2 history returns every complete pair in numeric user-message order', async () => {
  for (const ownerPipeline of ['legacy_v1', 'legacy_v2'] as const) {
    const taskId = ownerPipeline === 'legacy_v2' ? randomUUID() : null;
    const olderTurnId = randomUUID();
    const newerTurnId = randomUUID();
    const huge = `full-${'x'.repeat(30_000)}-tail`;
    const fake = queuedClient(
      { rows: [legacyTurnRow(newerTurnId, taskId), legacyTurnRow(olderTurnId, taskId)] },
      { rows: [
        storedMessage({ id: '10', role: 'user', turnId: newerTurnId, text: 'newer user' }),
        storedMessage({ id: '11', role: 'assistant', turnId: newerTurnId, text: 'newer assistant' }),
        storedMessage({ id: '2', role: 'user', turnId: olderTurnId, text: huge }),
        storedMessage({ id: '3', role: 'assistant', turnId: olderTurnId, text: 'older assistant' }),
      ] },
    );
    const input: LoadCanonicalHistoryInput = {
      conversationId,
      ownerPipeline,
      contextScopeId: taskId,
      includeConversation: ownerPipeline === 'legacy_v1',
    };

    const history = await loadCanonicalAnswerHistory(fake.client as never, input);

    assert.deepEqual(history.map((turn) => turn.turnId), [olderTurnId, newerTurnId]);
    assert.equal(history[0]?.user.text, huge);
    assert.deepEqual(fake.calls[0]?.values, [
      conversationId,
      ownerPipeline,
      taskId,
      ownerPipeline === 'legacy_v1',
    ]);
  }
});

test('V2.2 history uses the exact scope and numeric message IDs when timestamps tie', async () => {
  const scopeId = randomUUID();
  const olderTurnId = randomUUID();
  const newerTurnId = randomUUID();
  const completedAt = new Date('2026-07-28T00:00:00.000Z');
  const fake = queuedClient({ rows: [
    {
      conversation_id: conversationId,
      turn_id: newerTurnId,
      context_scope_id: scopeId,
      user_message_id: '10',
      assistant_message_id: '11',
      completed_at: completedAt,
      user_role: 'user',
      user_content: encodeTurnMessage(newerTurnId, 'newer user'),
      assistant_role: 'assistant',
      assistant_content: encodeTurnMessage(newerTurnId, 'newer assistant'),
    },
    {
      conversation_id: conversationId,
      turn_id: olderTurnId,
      context_scope_id: scopeId,
      user_message_id: '2',
      assistant_message_id: '3',
      completed_at: completedAt,
      user_role: 'user',
      user_content: encodeTurnMessage(olderTurnId, 'older user'),
      assistant_role: 'assistant',
      assistant_content: encodeTurnMessage(olderTurnId, 'older assistant'),
    },
  ] });

  const history = await loadCanonicalAnswerHistory(fake.client as never, {
    conversationId,
    ownerPipeline: 'context_packet_v22',
    contextScopeId: scopeId,
    includeConversation: false,
  });

  assert.deepEqual(history.map((turn) => turn.user.id), ['2', '10']);
  assert.deepEqual(fake.calls[0]?.values, [conversationId, scopeId]);
});

test('canonical history rejects missing, duplicate, role-invalid and turn-mismatched pairs uniformly', async () => {
  const turnId = randomUUID();
  const otherTurnId = randomUUID();
  const input: LoadCanonicalHistoryInput = {
    conversationId,
    ownerPipeline: 'legacy_v1',
    contextScopeId: null,
    includeConversation: true,
  };
  const invalidMessageSets = [
    [storedMessage({ id: '1', role: 'user', turnId, text: 'missing assistant' })],
    [
      storedMessage({ id: '1', role: 'user', turnId, text: 'user' }),
      storedMessage({ id: '1', role: 'assistant', turnId, text: 'duplicate id' }),
    ],
    [
      storedMessage({ id: '1', role: 'user', turnId, text: 'user one' }),
      storedMessage({ id: '2', role: 'user', turnId, text: 'user two' }),
    ],
    [
      storedMessage({ id: '1', role: 'user', turnId, text: 'user' }),
      storedMessage({ id: '2', role: 'assistant', turnId: otherTurnId, text: 'wrong turn' }),
    ],
  ];

  for (const messages of invalidMessageSets) {
    const fake = queuedClient({ rows: [legacyTurnRow(turnId)] }, { rows: messages });
    await assert.rejects(
      loadCanonicalAnswerHistory(fake.client as never, input),
      (error: unknown) => error instanceof Error
        && error.message === 'CONTEXT_COMPLETED_TURN_INVALID',
    );
  }
});

test('canonical history rejects message reuse across completed V2.2 turns', async () => {
  const scopeId = randomUUID();
  const firstTurnId = randomUUID();
  const secondTurnId = randomUUID();
  const row = (turnId: string) => ({
    conversation_id: conversationId,
    turn_id: turnId,
    context_scope_id: scopeId,
    user_message_id: '2',
    assistant_message_id: '3',
    completed_at: new Date('2026-07-28T00:00:00.000Z'),
    user_role: 'user',
    user_content: encodeTurnMessage(turnId, 'user'),
    assistant_role: 'assistant',
    assistant_content: encodeTurnMessage(turnId, 'assistant'),
  });
  const fake = queuedClient({ rows: [row(firstTurnId), row(secondTurnId)] });

  await assert.rejects(
    loadCanonicalAnswerHistory(fake.client as never, {
      conversationId,
      ownerPipeline: 'context_packet_v22',
      contextScopeId: scopeId,
      includeConversation: false,
    }),
    (error: unknown) => error instanceof Error
      && error.message === 'CONTEXT_COMPLETED_TURN_INVALID',
  );
});
