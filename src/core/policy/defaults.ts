/**
 * What each layer says by default.
 *
 * These are starting values, not facts about the world. Everything here is
 * overridable at a more specific scope, and the interesting ones are meant to
 * be overridden -- an instance is where the truth about a particular machine
 * lives.
 */

import type { Policy, ProviderType } from './types';

/**
 * Applies unless something below says otherwise.
 *
 * Only genuinely universal things belong here. `language` qualifies: the app
 * writes English prose for H3 and would have to be told otherwise. Concurrency
 * does not, and is deliberately absent -- a global default for it would be a
 * guess applied to every backend, and the whole point of the cascade is that
 * this particular fact is known per machine and nowhere else.
 */
export const GLOBAL_POLICY: Policy = {
  language: 'en',
};

/**
 * Per provider type.
 *
 * Deliberately thin. A type exists to avoid repeating a default across the
 * providers that share it, not to describe them -- so an attribute that differs
 * between two providers of the same type does not belong here even if both
 * currently agree on it.
 */
export const PROVIDER_TYPE_POLICY: Record<ProviderType, Policy> = {
  /**
   * Someone else's capacity, billed per token.
   *
   * Concurrency is bounded by quota rather than by hardware, and well above
   * anything this app does, so 4 is a self-imposed politeness rather than a
   * limit anyone enforces. The retry window is short because a hosted endpoint
   * that is refusing is rate-limiting rather than queueing, and waiting five
   * minutes for a quota to reset is not queueing behind work.
   */
  metered: {
    maxConcurrentRequests: 4,
    retryTimeoutMs: 30_000,
    typicalCallMs: 15_000,
  },

  /**
   * Capacity you own, where the ceiling is whatever the machine has.
   *
   * The conservative direction on purpose: 1 assumes no batching, which is
   * correct for a server that serialises generation and merely wasteful for one
   * that does not. Getting it wrong this way queues unnecessarily; getting it
   * wrong the other way means every second call is refused. An instance that
   * can do better says so.
   *
   * Five minutes of retry, and the number is measured rather than picked: a
   * 27B on a Mac Studio takes 40 to 60 seconds for a planner call and a
   * thinking run took 435. Queueing behind one of those is normal operation.
   */
  'self-operated': {
    maxConcurrentRequests: 1,
    retryTimeoutMs: 5 * 60_000,
    typicalCallMs: 50_000,
  },
};
