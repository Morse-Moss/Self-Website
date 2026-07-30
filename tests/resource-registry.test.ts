import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TurnPlanV1 } from '../lib/contracts/chat-turn-plan.ts';
import {
  ResourceRegistry,
  type ResourceDefinition,
} from '../lib/server/resource-registry.ts';

function resource(
  id: string,
  overrides: Partial<ResourceDefinition> = {},
): ResourceDefinition {
  return {
    id,
    kind: 'skill',
    source: {
      locator: `skills/${id}/SKILL.md`,
      revision: '2026-07-30',
      digest: `sha256:${id}`,
    },
    enabled: true,
    permissions: ['network'],
    approval: 'approved',
    executorKinds: ['agent'],
    ...overrides,
  };
}

test('a unique approved resource resolves by its exact id', () => {
  const registry = new ResourceRegistry();
  const entry = resource('skill:project-research');

  assert.equal(registry.register(entry).status, 'registered');
  assert.deepEqual(registry.list(), [entry]);
  assert.deepEqual(
    registry.resolveExecutable({ resourceId: entry.id, executorKind: 'agent' }),
    { status: 'resolved', resource: entry },
  );
});

test('a duplicate id reports a stable collision and preserves the first resource', () => {
  const registry = new ResourceRegistry();
  const first = resource('skill:research', {
    source: { locator: 'skills/first/SKILL.md', revision: 'v1', digest: 'sha256:first' },
  });
  const duplicate = resource('skill:research', {
    source: { locator: 'skills/second/SKILL.md', revision: 'v2', digest: 'sha256:second' },
  });

  registry.register(first);
  assert.deepEqual(registry.register(duplicate), {
    status: 'collision',
    diagnostic: {
      code: 'RESOURCE_ID_COLLISION',
      resourceId: 'skill:research',
      existing: first.source,
      incoming: duplicate.source,
    },
  });
  assert.deepEqual(registry.inspect('skill:research'), first);
});

test('disabled or unapproved resources never resolve as executable', () => {
  const registry = new ResourceRegistry();
  const disabled = resource('skill:disabled', { enabled: false });
  const pending = resource('skill:pending', { approval: 'pending' });
  const revoked = resource('skill:revoked', { approval: 'revoked' });

  registry.register(disabled);
  registry.register(pending);
  registry.register(revoked);

  assert.deepEqual(
    registry.resolveExecutable({ resourceId: disabled.id, executorKind: 'agent' }),
    { status: 'rejected', diagnostic: { code: 'RESOURCE_DISABLED', resourceId: disabled.id } },
  );
  assert.deepEqual(
    registry.resolveExecutable({ resourceId: pending.id, executorKind: 'agent' }),
    { status: 'rejected', diagnostic: { code: 'RESOURCE_APPROVAL_REQUIRED', resourceId: pending.id } },
  );
  assert.deepEqual(
    registry.resolveExecutable({ resourceId: revoked.id, executorKind: 'agent' }),
    { status: 'rejected', diagnostic: { code: 'RESOURCE_APPROVAL_REVOKED', resourceId: revoked.id } },
  );
});

test('an explicit loader receives only the approved resource selected for execution', async () => {
  const registry = new ResourceRegistry();
  const selected = resource('skill:selected');
  const unselected = resource('skill:unselected');
  const loadedIds: string[] = [];

  registry.register(selected);
  registry.register(unselected);

  const result = await registry.load(
    { resourceId: selected.id, executorKind: 'agent' },
    {
      async load(entry) {
        loadedIds.push(entry.id);
        return 'selected skill body';
      },
    },
  );

  assert.deepEqual(loadedIds, [selected.id]);
  assert.deepEqual(result, {
    status: 'loaded',
    resource: selected,
    payload: 'selected skill body',
  });
});

test('the active turn contract remains direct-only', () => {
  type DirectOnly = TurnPlanV1['executor'] extends { kind: 'direct' } ? true : false;
  const directOnly: DirectOnly = true;

  assert.equal(directOnly, true);
});
