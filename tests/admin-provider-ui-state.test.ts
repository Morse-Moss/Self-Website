import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  effectiveRouteInputs,
  preserveLockedRouteIndices,
  replaceEnvironmentTarget,
  testStateLabels,
} from '../components/admin/provider-ui-state.ts';
import type {
  ProviderRuntimeSummary,
  RouteTargetInput,
} from '../components/admin/admin-api-client.ts';

test('server test state maps to separate eligibility and latest-result labels', () => {
  assert.deepEqual(testStateLabels({
    eligibility: 'eligible',
    successExpiresAt: '2026-07-27T10:30:00.000Z',
    latestTest: {
      latencyMs: null,
      resultCode: 'AI_CONFIG_TEST_FAILED',
      status: 'failed',
      testedAt: '2026-07-27T10:10:00.000Z',
    },
  }), {
    eligibility: '30 分钟内测试通过',
    latest: '最近测试失败',
  });
  assert.deepEqual(testStateLabels({
    eligibility: 'expired',
    successExpiresAt: '2026-07-27T09:30:00.000Z',
    latestTest: {
      latencyMs: 12,
      resultCode: 'AI_CONFIG_TEST_SUCCEEDED',
      status: 'succeeded',
      testedAt: '2026-07-27T09:00:00.000Z',
    },
  }), {
    eligibility: '测试已过期',
    latest: '最近测试通过 · 12ms',
  });
  assert.deepEqual(testStateLabels({
    eligibility: 'untested',
    successExpiresAt: null,
    latestTest: null,
  }), {
    eligibility: '尚未测试通过',
    latest: '暂无测试记录',
  });
});

test('Environment replacement preserves position and every unrelated target identity', () => {
  const current: RouteTargetInput[] = [
    { source: 'environment', environmentTargetKey: 'primary' },
    {
      source: 'database',
      modelId: '11111111-1111-4111-8111-111111111111',
      modelVersionId: '21111111-1111-4111-8111-111111111111',
    },
    { source: 'environment', environmentTargetKey: 'fallback-1' },
  ];
  const replacement = {
    source: 'database' as const,
    modelId: '31111111-1111-4111-8111-111111111111',
    modelVersionId: '41111111-1111-4111-8111-111111111111',
  };
  const next = replaceEnvironmentTarget(current, 'primary', replacement);

  assert.ok(next);
  assert.notEqual(next, current);
  assert.equal(next.length, current.length);
  assert.equal(next[0], replacement);
  assert.equal(next[1], current[1]);
  assert.equal(next[2], current[2]);
  assert.equal(replaceEnvironmentTarget(current, 'fallback-2', replacement), null);
});

test('effective route inputs preserve explicit versions and fall back to Environment baseline', () => {
  const runtime = {
    activeRevision: 4,
    canRollback: true,
    environmentTargets: [
      { environmentTargetKey: 'primary' },
      { environmentTargetKey: 'fallback-1' },
    ],
    routeRevisionId: '51111111-1111-4111-8111-111111111111',
    targets: [
      {
        databaseModelSeriesId: '61111111-1111-4111-8111-111111111111',
        databaseModelVersionId: '71111111-1111-4111-8111-111111111111',
        environmentTargetKey: null,
        sourceType: 'database',
      },
      {
        databaseModelSeriesId: null,
        databaseModelVersionId: null,
        environmentTargetKey: 'fallback-1',
        sourceType: 'environment',
      },
    ],
  } as ProviderRuntimeSummary;
  assert.deepEqual(effectiveRouteInputs(runtime), [
    {
      source: 'database',
      modelId: '61111111-1111-4111-8111-111111111111',
      modelVersionId: '71111111-1111-4111-8111-111111111111',
    },
    { source: 'environment', environmentTargetKey: 'fallback-1' },
  ]);
  assert.deepEqual(effectiveRouteInputs({
    ...runtime,
    activeRevision: 0,
    routeRevisionId: null,
    targets: [],
  }), [
    { source: 'environment', environmentTargetKey: 'primary' },
    { source: 'environment', environmentTargetKey: 'fallback-1' },
  ]);
});

test('locked route indices reject movement and crossing while allowing same-side changes', () => {
  const current = ['a', 'locked', 'b', 'c'];
  const locked = new Set(['locked']);
  for (const invalid of [
    ['a', 'b', 'locked', 'c'],
    ['a', 'b', 'c'],
    ['b', 'locked', 'a', 'c'],
    ['c', 'locked', 'b', 'a'],
    ['locked', 'b', 'c'],
    ['new', 'a', 'locked', 'b', 'c'],
    ['new', 'locked', 'b', 'c'],
  ]) {
    assert.equal(preserveLockedRouteIndices(current, invalid, locked), current);
  }
  const reordered = ['a', 'locked', 'c', 'b'];
  assert.equal(preserveLockedRouteIndices(current, reordered, locked), reordered);
  const appended = ['a', 'locked', 'b', 'c', 'new'];
  assert.equal(preserveLockedRouteIndices(current, appended, locked), appended);
  const removedAfter = ['a', 'locked', 'c'];
  assert.equal(preserveLockedRouteIndices(current, removedAfter, locked), removedAfter);
});

test('locked candidate position survives every permitted route mutation', () => {
  const current = ['a', 'locked', 'b', 'c'];
  const locked = new Set(['locked']);
  const mutations = {
    dragged: ['c', 'locked', 'a', 'b'],
    moved: ['b', 'locked', 'a', 'c'],
    removed: ['a', 'locked', 'c'],
    appended: ['a', 'locked', 'b', 'c', 'new'],
  };

  for (const next of Object.values(mutations)) {
    const result = preserveLockedRouteIndices(current, next, locked);
    assert.equal(result?.indexOf('locked'), 1);
  }
});
