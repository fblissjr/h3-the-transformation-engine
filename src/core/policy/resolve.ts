/**
 * The cascade: first layer that states a value wins.
 *
 * Per attribute, not per layer. A provider that sets only `maxConcurrentRequests`
 * still inherits `language` from global -- the layers are not alternative
 * configurations, they are overlapping sets of exceptions. Getting this wrong
 * in the other direction (a lower layer replacing the whole object) is the
 * classic version of this bug and the reason `resolve` walks keys rather than
 * merging objects positionally.
 */

import { POLICY_KEYS, SCOPES, type Policy, type PolicyLayers, type Scope, type Sourced } from './types';

/**
 * The effective policy.
 *
 * Absent everywhere means absent in the result: there is no invented default,
 * because a caller that needs one knows better than this function what it
 * should be, and a silent default here would be indistinguishable from a value
 * someone configured.
 */
export function resolvePolicy(layers: PolicyLayers): Policy {
  const out: Policy = {};
  for (const key of POLICY_KEYS) {
    const found = resolveAttribute(layers, key);
    if (found) {
      // Assigned through a cast because TypeScript cannot see that the key and
      // the value came from the same attribute; they did, by construction.
      (out as Record<string, unknown>)[key] = found.value;
    }
  }
  return out;
}

/**
 * One attribute, with the scope that supplied it.
 *
 * The scope is returned because "why is this 1?" is the question anyone asks
 * of a cascade, and a resolver that cannot answer it makes people read four
 * config layers by hand. The UI uses it to explain itself.
 */
export function resolveAttribute<K extends keyof Policy>(
  layers: PolicyLayers,
  key: K,
): Sourced<NonNullable<Policy[K]>> | null {
  for (const scope of SCOPES) {
    const value = layers[scope]?.[key];
    if (value !== undefined) {
      return { value: value as NonNullable<Policy[K]>, scope };
    }
  }
  return null;
}

/** Every resolved attribute with its source, for a settings view or a log line. */
export function explainPolicy(layers: PolicyLayers): Partial<Record<keyof Policy, Sourced<unknown>>> {
  const out: Partial<Record<keyof Policy, Sourced<unknown>>> = {};
  for (const key of POLICY_KEYS) {
    const found = resolveAttribute(layers, key);
    if (found) out[key] = found;
  }
  return out;
}

/**
 * Build the layer set from parts, dropping the ones that said nothing.
 *
 * A convenience so callers assemble layers positionally without repeating the
 * scope names, and so an absent layer and an empty one are the same thing --
 * `{}` at a scope must not shadow anything below it, and it does not, because
 * `resolveAttribute` tests each key rather than the layer's presence.
 */
export function layersFrom(parts: PolicyLayers): PolicyLayers {
  const out: PolicyLayers = {};
  for (const scope of SCOPES) {
    const layer = parts[scope];
    if (layer && Object.keys(layer).length > 0) out[scope] = layer;
  }
  return out;
}

/** The scopes, most specific first. Re-exported so callers need not guess the order. */
export function scopeOrder(): readonly Scope[] {
  return SCOPES;
}
