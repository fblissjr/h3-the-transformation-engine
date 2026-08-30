/**
 * Operational policy: what a backend can do, and where that is stated.
 *
 * Pure, and in `core/` for the reason everything else here is -- it is data and
 * arithmetic over data, with nothing to say about transports. The provider
 * layer supplies the instance and provider layers; this module has no idea
 * which backends exist and must not gain one.
 *
 * The `.ts` extensions here and in the files this re-exports are load-bearing.
 * `vite.config.ts` reaches this module through `provider/registry.ts` and is
 * loaded by Node, which resolves neither a missing extension nor a directory
 * index. See `allowImportingTsExtensions` in tsconfig.json.
 */

export { GLOBAL_POLICY, PROVIDER_TYPE_POLICY } from './defaults.ts';
export { explainPolicy, layersFrom, resolveAttribute, resolvePolicy, scopeOrder } from './resolve.ts';
export { POLICY_KEYS, PROVIDER_TYPES, SCOPES } from './types.ts';
export type { Policy, PolicyLayers, ProviderType, Scope, Sourced } from './types.ts';
