/**
 * Which providers exist, what type each is, and where its instances are.
 *
 * The bridge between `core/policy`, which knows the cascade and nothing about
 * backends, and the clients, which know one backend each and nothing about the
 * cascade. Everything provider-specific is data in this file.
 *
 * The split that matters, and it is a security split rather than a taste one:
 *
 *   BUILD TIME decides which hosts may be contacted at all. Instance origins
 *   come from the environment, because the page's `connect-src` is generated
 *   from the same value -- an origin the policy does not name is refused by the
 *   browser before the request leaves, with no status and no response.
 *
 *   RUN TIME decides how to treat them. Concurrency, retry budget and the rest
 *   are behaviour, they are editable, and getting one wrong costs a slow call
 *   rather than a hole in the policy.
 *
 * So you cannot add a machine from the UI, and you can say from the UI that the
 * machine you added is slow. That asymmetry is deliberate.
 */

import {
  GLOBAL_POLICY,
  PROVIDER_TYPE_POLICY,
  resolvePolicy,
  explainPolicy,
  type Policy,
  type PolicyLayers,
  type ProviderType,
  type Sourced,
} from '../core/policy';
import { normalizeOrigin } from './heylook/config';
import type { ProviderId } from './types';

export interface ProviderDescriptor {
  id: ProviderId;
  /**
   * Whether this backend can constrain decoding to a schema.
   *
   * Stated here rather than read off a live client, because a client only
   * exists once there is a key or a chosen model -- and reading
   * `client?.canEnforceSchema ?? false` made the answer false on first load,
   * where the UI then told the user that Gemini cannot constrain decoding.
   * The capability is a fact about the provider and is available before any
   * client is built.
   */
  canEnforceSchema: boolean;
  /** Its bundle of defaults. Nothing branches on this; see core/policy/types.ts. */
  type: ProviderType;
  label: string;
  /** Anything true of this provider on every machine. Usually nothing. */
  policy?: Policy;
}

export const PROVIDERS: Record<ProviderId, ProviderDescriptor> = {
  gemini: {
    id: 'gemini',
    type: 'metered',
    label: 'Gemini',
    canEnforceSchema: true,
    // Nothing: everything true of Gemini is true of the `metered` type, and
    // repeating it here would be a second copy to keep in step.
  },
  heylook: {
    id: 'heylook',
    type: 'self-operated',
    label: 'heylook (local)',
    canEnforceSchema: false,
    // Also nothing, and deliberately. It is tempting to put
    // maxConcurrentRequests: 1 here because the machine it runs on today
    // serialises generation -- but that is a fact about that machine, not about
    // heylook, and the same build on a box with a discrete GPU could batch.
    // Stating it here would make every future instance inherit one machine's
    // limitation. It belongs to the instance.
  },
};

/** A named endpoint for a provider. */
export interface Instance {
  id: string;
  providerId: ProviderId;
  origin: string;
}

/**
 * heylook endpoints, parsed from the environment.
 *
 * `VITE_HEYLOOK_INSTANCES` is a comma-separated list of `name=origin`. A bare
 * `VITE_HEYLOOK_ORIGIN` is still honoured as a single unnamed instance, because
 * that is what shipped and a build that silently stopped reading it would look
 * like the server being down.
 *
 * Names are for you, not for the code -- nothing resolves behaviour by matching
 * an instance name, only by looking up its policy overrides.
 */
export function parseInstances(spec: string | undefined, fallbackOrigin: string | undefined): Instance[] {
  const listed = (spec ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const at = entry.indexOf('=');
      // An entry with no `=` is an origin with no name; name it after itself
      // rather than dropping it, since dropping it silently loses a machine.
      const id = at === -1 ? entry.trim() : entry.slice(0, at).trim();
      const origin = at === -1 ? entry.trim() : entry.slice(at + 1).trim();
      return { id, providerId: 'heylook' as const, origin: normalizeOrigin(origin) };
    })
    .filter((instance) => instance.id !== '' && instance.origin !== '');

  if (listed.length > 0) return listed;
  return [{ id: 'default', providerId: 'heylook', origin: normalizeOrigin(fallbackOrigin) }];
}

/**
 * Injected by `vite.config.ts` from the same parse that generates `connect-src`.
 *
 * Not read from `import.meta.env` here, and that is the point: the config reads
 * env through `loadEnv` while the bundle reads it through Vite's define pass,
 * and those are different surfaces. A variable given on the command line
 * reached the policy and not the client, so the two named different hosts and
 * every request was refused with no status. One computation, injected, removes
 * the possibility rather than documenting it.
 *
 * The fallback keeps a plain `vitest` run working, where no Vite define exists.
 */
declare const __HEYLOOK_INSTANCES__: Instance[] | undefined;

export const HEYLOOK_INSTANCES: Instance[] =
  typeof __HEYLOOK_INSTANCES__ !== 'undefined' && __HEYLOOK_INSTANCES__.length > 0
    ? __HEYLOOK_INSTANCES__
    : parseInstances(undefined, undefined);

/** Every origin any client may contact, which is what `connect-src` must name. */
export function allOrigins(instances: Instance[] = HEYLOOK_INSTANCES): string[] {
  return [...new Set(instances.map((i) => i.origin))];
}

/**
 * The instance to talk to, resolved from a stored id.
 *
 * The only place a heylook origin comes from. That is the whole point: for a
 * while the CSP was generated from the instance list while the client still
 * read `HEYLOOK_ORIGIN` directly, so setting `VITE_HEYLOOK_INSTANCES` to a
 * different host produced a policy naming one machine and a client fetching
 * another -- refused by the browser with no status, which is exactly the
 * failure the single-source arrangement exists to prevent. It was possible
 * because the instance layer was added for the policy and never wired to the
 * client. Anything that needs an origin resolves it through here.
 */
export function instanceFor(instanceId: string | null): Instance {
  return HEYLOOK_INSTANCES.find((i) => i.id === instanceId) ?? HEYLOOK_INSTANCES[0];
}

/**
 * The layers for a provider, with an instance's overrides on top.
 *
 * Assembled here rather than in the UI so that every caller resolves the same
 * way. `instancePolicy` is whatever the user has stored for that machine, which
 * is the only layer that is editable at runtime.
 */
export function layersFor(
  providerId: ProviderId,
  instancePolicy: Policy = {},
): PolicyLayers {
  const descriptor = PROVIDERS[providerId];
  return {
    global: GLOBAL_POLICY,
    providerType: PROVIDER_TYPE_POLICY[descriptor.type],
    ...(descriptor.policy ? { provider: descriptor.policy } : {}),
    instance: instancePolicy,
  };
}

/** The effective policy for a provider on a particular machine. */
export function policyFor(providerId: ProviderId, instancePolicy: Policy = {}): Policy {
  return resolvePolicy(layersFor(providerId, instancePolicy));
}

/** The same, with the scope each value came from, for the UI to explain itself. */
export function explainFor(
  providerId: ProviderId,
  instancePolicy: Policy = {},
): Partial<Record<keyof Policy, Sourced<unknown>>> {
  return explainPolicy(layersFor(providerId, instancePolicy));
}

/**
 * The parts of a heylook client's construction that come from policy.
 *
 * Extracted as a pure function because the alternative is a mapping buried in a
 * React memo, where nothing can reach it -- the same shape as every other
 * wiring gap this repo has found: chosen in one place, consumed in another, and
 * invisible in between.
 *
 * Only attributes that actually change the client's behaviour appear here.
 * `maxConcurrentRequests` deliberately does not: see `describeConcurrency`.
 */
export function heylookPolicyConfig(policy: Policy): { backpressureBudgetMs?: number } {
  return policy.retryTimeoutMs != null ? { backpressureBudgetMs: policy.retryTimeoutMs } : {};
}

/**
 * What `maxConcurrentRequests` currently means, which is less than it looks.
 *
 * It is resolved, displayed and overridable, and nothing gates on it. The app
 * issues one model call at a time regardless, because `generate` and
 * `applyAssisted` both return early while `busy` is set and they share a single
 * abort controller. That guard is stricter than any policy value, so a policy
 * of 4 does not permit 4.
 *
 * Said out loud here rather than left for someone to discover, because an
 * attribute that looks like a limit and is not is worse than an absent one. To
 * make it load-bearing, the single-flight guard and the single `abortRef` are
 * what would have to change first.
 */
export function describeConcurrency(policy: Policy): string {
  const declared = policy.maxConcurrentRequests ?? 1;
  return declared > 1
    ? `${declared} declared, but this app issues one call at a time regardless`
    : '1 call at a time';
}
