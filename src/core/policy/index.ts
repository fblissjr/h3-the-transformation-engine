/**
 * Operational policy: what a backend can do, and where that is stated.
 *
 * Pure, and in `core/` for the reason everything else here is -- it is data and
 * arithmetic over data, with nothing to say about transports. The provider
 * layer supplies the instance and provider layers; this module has no idea
 * which backends exist and must not gain one.
 */

export { GLOBAL_POLICY, PROVIDER_TYPE_POLICY } from './defaults';
export { explainPolicy, layersFrom, resolveAttribute, resolvePolicy, scopeOrder } from './resolve';
export { POLICY_KEYS, PROVIDER_TYPES, SCOPES } from './types';
export type { Policy, PolicyLayers, ProviderType, Scope, Sourced } from './types';
