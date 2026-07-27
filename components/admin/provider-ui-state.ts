import type {
  EnvironmentTarget,
  ProviderRuntimeSummary,
  ProviderTestState,
  RouteTargetInput,
} from './admin-api-client';

export function testStateLabels(state: ProviderTestState): {
  eligibility: string;
  latest: string;
} {
  const eligibility = state.eligibility === 'eligible'
    ? '30 分钟内测试通过'
    : state.eligibility === 'expired'
      ? '测试已过期'
      : '尚未测试通过';
  if (!state.latestTest) return { eligibility, latest: '暂无测试记录' };
  if (state.latestTest.status === 'failed') return { eligibility, latest: '最近测试失败' };
  return {
    eligibility,
    latest: state.latestTest.latencyMs === null
      ? '最近测试通过'
      : `最近测试通过 · ${state.latestTest.latencyMs}ms`,
  };
}

export function replaceEnvironmentTarget(
  current: RouteTargetInput[],
  targetKey: EnvironmentTarget['environmentTargetKey'],
  replacement: Extract<RouteTargetInput, { source: 'database' }>,
): RouteTargetInput[] | null {
  const index = current.findIndex((target) => (
    target.source === 'environment' && target.environmentTargetKey === targetKey
  ));
  if (index === -1) return null;
  const next = [...current];
  next[index] = replacement;
  return next;
}

export function effectiveRouteInputs(runtime: ProviderRuntimeSummary): RouteTargetInput[] {
  if (!runtime.routeRevisionId) {
    return runtime.environmentTargets.map((target) => ({
      source: 'environment',
      environmentTargetKey: target.environmentTargetKey,
    }));
  }
  return runtime.targets.flatMap((target): RouteTargetInput[] => {
    if (target.sourceType === 'environment' && target.environmentTargetKey) {
      return [{ source: 'environment', environmentTargetKey: target.environmentTargetKey }];
    }
    if (target.sourceType === 'database'
      && target.databaseModelSeriesId
      && target.databaseModelVersionId) {
      return [{
        source: 'database',
        modelId: target.databaseModelSeriesId,
        modelVersionId: target.databaseModelVersionId,
      }];
    }
    return [];
  });
}

export function preserveLockedRouteIndices(
  currentKeys: string[],
  nextKeys: string[],
  lockedKeys: ReadonlySet<string>,
): string[] {
  const sameMembers = (left: string[], right: string[]) => (
    left.length === right.length
    && left.every((key) => right.includes(key))
  );

  for (let index = 0; index < currentKeys.length; index += 1) {
    const lockedKey = currentKeys[index];
    if (!lockedKeys.has(lockedKey)) continue;
    if (nextKeys[index] !== lockedKey
      || !sameMembers(currentKeys.slice(0, index), nextKeys.slice(0, index))) {
      return currentKeys;
    }
  }
  return nextKeys;
}
