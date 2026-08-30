/**
 * Operational attributes, and the scopes they can be set at.
 *
 * This is deliberately not a description of backends. It is a set of properties
 * a backend HAS, and a cascade saying where each one may be stated. The
 * distinction is the whole design:
 *
 * **Nothing branches on a provider type.** No `if (type === 'local')` anywhere,
 * ever. Code reads `maxConcurrentRequests`, and a type is only a convenient
 * place to put a default so it is not repeated. That is what makes the type
 * names safe to get wrong -- rename `self-hosted` tomorrow and nothing but a
 * label moves, because no behaviour was ever keyed to the word.
 *
 * The names in this file were chosen against a specific trap. `cloud` vs
 * `server`, `local` vs `remote`, `hosted` vs `self-hosted` all bundle together
 * things that vary independently: where the machine is, who operates it,
 * whether it is metered, whether it batches, and whether prompts leave your
 * control. The same heylook build on a Mac Studio serialises generation and has
 * 192GB of unified memory; on a Linux box with a 4090 it could batch and has
 * 24GB. Same provider, same type, different machine -- so the concurrency fact
 * belongs to the INSTANCE, not to heylook and not to a category containing it.
 */

/**
 * Where a value may be stated, most specific first.
 *
 * Resolution walks this array in order and takes the first layer that defines
 * the attribute, so the order here IS the precedence. Adding a level is one
 * splice: the union below is derived from the array the way `vocab.ts` derives
 * its ids, so a new scope needs no type edited anywhere and no level
 * renumbered. Nothing stores a level number, which is what makes insertion in
 * the middle cheap rather than a migration.
 */
export const SCOPES = ['instance', 'provider', 'providerType', 'global'] as const;

export type Scope = (typeof SCOPES)[number];

/**
 * The provider types that exist today.
 *
 * Two, and they are named for the operational contract rather than for a place.
 * `metered` is someone else's capacity, billed per token, effectively unbounded
 * concurrency. `self-operated` is capacity you own, where the ceiling is
 * whatever the machine has and running out is your problem rather than a bill.
 *
 * A third would slot in here with its defaults and nothing else would change.
 */
export const PROVIDER_TYPES = ['metered', 'self-operated'] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

/**
 * Every attribute the cascade can carry.
 *
 * All optional at every layer, because a layer states exceptions rather than a
 * complete configuration -- language is a global fact nobody wants to restate
 * per provider, and concurrency is a machine fact nobody wants to state
 * globally. A layer that has no opinion omits the key.
 *
 * Add attributes here. Every one becomes settable at every scope for free,
 * which is the point of the shape.
 */
export interface Policy {
  /**
   * BCP-47 tag for the language the model should write in.
   *
   * The example of an attribute that is almost always global. Settable lower
   * because "almost" is not "always" -- a model that only writes English well
   * is a per-provider fact.
   */
  language?: string;

  /**
   * How many calls may be in flight against this backend at once.
   *
   * 1 means serialise. It is the attribute with actual teeth: a server that
   * runs one generation at a time answers 503 to anything else, and today the
   * app discovers that by being refused rather than by knowing it.
   */
  maxConcurrentRequests?: number;

  /**
   * How long to keep queueing behind a busy backend before giving up, in ms.
   *
   * Calibrated to how long a generation takes there, which is why it belongs
   * beside concurrency rather than being a constant in a client: five minutes
   * is right for a box that takes minutes per call and absurd for a hosted API
   * that answers in seconds.
   */
  retryTimeoutMs?: number;

  /**
   * Roughly how long one call takes, in milliseconds.
   *
   * A number rather than a named class, for the same reason the type names are
   * not locations: `fast`/`slow` is a bucket someone has to re-cut the moment a
   * third backend lands between them, whereas a number never needs renaming and
   * the UI can bucket it however it likes at the point of use.
   */
  typicalCallMs?: number;
}

/** The attribute names, for iterating a Policy without hand-listing its keys. */
export const POLICY_KEYS = [
  'language',
  'maxConcurrentRequests',
  'retryTimeoutMs',
  'typicalCallMs',
] as const satisfies readonly (keyof Policy)[];

/** What each scope contributes. A scope with nothing to say may be absent. */
export type PolicyLayers = Partial<Record<Scope, Policy>>;

/** A resolved value together with the scope that supplied it. */
export interface Sourced<T> {
  value: T;
  scope: Scope;
}
