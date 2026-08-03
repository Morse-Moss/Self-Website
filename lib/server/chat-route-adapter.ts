import type { TurnIntent, TurnRoute } from './chat-behavior.ts';
import type { ChatRouteDecision } from './chat-route-policy.ts';

export function adaptV2Route(route: ChatRouteDecision): TurnRoute {
  const intent: TurnIntent = route.routeKind === 'conversation' || route.routeKind === 'clarify'
    ? 'social'
    : route.routeKind === 'identity'
      ? 'identity'
      : route.routeKind === 'jd'
        ? 'jd'
        : route.routeKind === 'personal_fact' || route.routeKind === 'jd_intake'
          ? 'recruitment'
          : route.routeKind === 'external_current'
            ? 'technical'
            : 'project';
  return {
    intent,
    profile: route.routeKind === 'conversation' || route.routeKind === 'clarify'
      ? 'social'
      : route.routeKind === 'jd'
        ? 'jd'
        : 'grounded',
    evidence: route.routeKind === 'identity'
      ? 'identity'
      : route.requiresEmbedding
        ? 'rag'
        : 'none',
    release: route.release,
    reasoningEffort: undefined,
  };
}
