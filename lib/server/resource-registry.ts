export type ResourceKind = 'skill' | 'tool' | 'executor';
export type ResourceExecutorKind = 'direct' | 'agent';
export type ResourceApproval = 'not_required' | 'pending' | 'approved' | 'revoked';

export interface ResourceSource {
  readonly locator: string;
  readonly revision: string;
  readonly digest: string;
}

export interface ResourceDefinition {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly source: ResourceSource;
  readonly enabled: boolean;
  readonly permissions: readonly string[];
  readonly approval: ResourceApproval;
  readonly executorKinds: readonly ResourceExecutorKind[];
}

export interface ResourceCollisionDiagnostic {
  readonly code: 'RESOURCE_ID_COLLISION';
  readonly resourceId: string;
  readonly existing: ResourceSource;
  readonly incoming: ResourceSource;
}

export type ResourceResolutionDiagnostic =
  | { readonly code: 'RESOURCE_NOT_FOUND'; readonly resourceId: string }
  | { readonly code: 'RESOURCE_DISABLED'; readonly resourceId: string }
  | { readonly code: 'RESOURCE_APPROVAL_REQUIRED'; readonly resourceId: string }
  | { readonly code: 'RESOURCE_APPROVAL_REVOKED'; readonly resourceId: string }
  | {
    readonly code: 'RESOURCE_EXECUTOR_INCOMPATIBLE';
    readonly resourceId: string;
    readonly executorKind: ResourceExecutorKind;
  };

export type ResourceRegistrationResult =
  | { readonly status: 'registered'; readonly resource: ResourceDefinition }
  | { readonly status: 'collision'; readonly diagnostic: ResourceCollisionDiagnostic };

export type ResourceResolution =
  | { readonly status: 'resolved'; readonly resource: ResourceDefinition }
  | { readonly status: 'rejected'; readonly diagnostic: ResourceResolutionDiagnostic };

export interface ResourcePayloadLoader<Payload> {
  load(resource: ResourceDefinition): Promise<Payload>;
}

export type ResourceLoadResult<Payload> =
  | { readonly status: 'loaded'; readonly resource: ResourceDefinition; readonly payload: Payload }
  | Extract<ResourceResolution, { status: 'rejected' }>;

function snapshot(resource: ResourceDefinition): ResourceDefinition {
  return Object.freeze({
    ...resource,
    source: Object.freeze({ ...resource.source }),
    permissions: Object.freeze([...resource.permissions]),
    executorKinds: Object.freeze([...resource.executorKinds]),
  });
}

function assertValidDefinition(resource: ResourceDefinition): void {
  if (resource.id.trim().length === 0 || resource.id !== resource.id.trim()) {
    throw new Error('RESOURCE_ID_INVALID');
  }
  if (
    resource.source.locator.trim().length === 0
    || resource.source.revision.trim().length === 0
    || resource.source.digest.trim().length === 0
  ) {
    throw new Error('RESOURCE_SOURCE_INVALID');
  }
  if (resource.approval === 'not_required' && resource.permissions.length > 0) {
    throw new Error('RESOURCE_APPROVAL_STATE_INVALID');
  }
  if (resource.approval !== 'not_required' && resource.permissions.length === 0) {
    throw new Error('RESOURCE_APPROVAL_STATE_INVALID');
  }
}

/**
 * The only future resource lookup boundary. It stores discovery metadata only;
 * callers must explicitly select and load one eligible resource.
 */
export class ResourceRegistry {
  readonly #resources = new Map<string, ResourceDefinition>();

  register(resource: ResourceDefinition): ResourceRegistrationResult {
    assertValidDefinition(resource);
    const existing = this.#resources.get(resource.id);
    if (existing) {
      return {
        status: 'collision',
        diagnostic: {
          code: 'RESOURCE_ID_COLLISION',
          resourceId: resource.id,
          existing: existing.source,
          incoming: resource.source,
        },
      };
    }

    const registered = snapshot(resource);
    this.#resources.set(registered.id, registered);
    return { status: 'registered', resource: registered };
  }

  inspect(resourceId: string): ResourceDefinition | undefined {
    return this.#resources.get(resourceId);
  }

  list(): readonly ResourceDefinition[] {
    return [...this.#resources.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  resolveExecutable(input: {
    resourceId: string;
    executorKind: ResourceExecutorKind;
  }): ResourceResolution {
    const resource = this.inspect(input.resourceId);
    if (!resource) {
      return {
        status: 'rejected',
        diagnostic: { code: 'RESOURCE_NOT_FOUND', resourceId: input.resourceId },
      };
    }
    if (!resource.enabled) {
      return {
        status: 'rejected',
        diagnostic: { code: 'RESOURCE_DISABLED', resourceId: resource.id },
      };
    }
    if (resource.approval === 'pending') {
      return {
        status: 'rejected',
        diagnostic: { code: 'RESOURCE_APPROVAL_REQUIRED', resourceId: resource.id },
      };
    }
    if (resource.approval === 'revoked') {
      return {
        status: 'rejected',
        diagnostic: { code: 'RESOURCE_APPROVAL_REVOKED', resourceId: resource.id },
      };
    }
    if (!resource.executorKinds.includes(input.executorKind)) {
      return {
        status: 'rejected',
        diagnostic: {
          code: 'RESOURCE_EXECUTOR_INCOMPATIBLE',
          resourceId: resource.id,
          executorKind: input.executorKind,
        },
      };
    }
    return { status: 'resolved', resource };
  }

  async load<Payload>(
    input: { resourceId: string; executorKind: ResourceExecutorKind },
    loader: ResourcePayloadLoader<Payload>,
  ): Promise<ResourceLoadResult<Payload>> {
    const resolution = this.resolveExecutable(input);
    if (resolution.status === 'rejected') return resolution;
    const payload = await loader.load(resolution.resource);
    return { status: 'loaded', resource: resolution.resource, payload };
  }
}
