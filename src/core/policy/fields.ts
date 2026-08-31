/**
 * What each policy attribute IS, for the two places that have to know.
 *
 * A stored override has to be validated before it is trusted, and a settings
 * control has to be rendered. Both questions have the same answer -- what kind
 * of value this attribute holds -- and answering it twice is how a validator
 * that accepts a string and a control that emits a number end up in the same
 * build. So the kind is stated once, here, and `src/db/policy.ts` builds its
 * parser from this table while the UI renders its inputs from it.
 *
 * `satisfies Record<keyof Policy, PolicyField>` is the load-bearing part: an
 * attribute added to `Policy` with no entry here fails to compile, and an entry
 * for an attribute that no longer exists fails the same way. Neither direction
 * is a list someone has to remember to update, which is the difference between
 * a guarantee and a habit.
 *
 * The labels live here rather than in the UI for the same reason. Splitting the
 * label from the kind makes two tables keyed by the same thing, and a new
 * attribute would then be settable, validated, and unnamed.
 */

import type { Policy } from './types.ts';

/**
 * How a value is entered and checked.
 *
 * `duration-ms` is stored in milliseconds and only differs from `integer` in
 * how it is shown: a retry budget reads as 300000 to nobody. Kept as its own
 * kind rather than a `unit` field on `integer`, because the moment there are
 * two of them the renderer needs a switch either way.
 */
export type PolicyFieldKind = 'text' | 'integer' | 'duration-ms';

export interface PolicyField {
  kind: PolicyFieldKind;
  /** What the settings control is called. */
  label: string;
  /**
   * Whether a stored override for it would change anything.
   *
   * The honest half of this table, and the reason it is a required field
   * rather than an optional flag: three of the four attributes below are read
   * by nothing in `src/`, and a settings panel that offered inputs for them
   * would be four controls of which one works. That is the trap this repo has
   * already paid for once -- `maxConcurrentRequests` is resolved, displayed,
   * and gates nothing, said out loud in `describeConcurrency` because an
   * attribute that looks like a limit and is not is worse than an absent one.
   *
   * `satisfies` forces every new attribute to answer the question. Answering
   * it false is not a defect; shipping an input for it would be. Flip one to
   * true when a consumer exists, not when one is planned.
   */
  settable: boolean;
  /**
   * The smallest value that means anything.
   *
   * Not a taste limit. Zero concurrent requests is a backend nobody can call
   * and a negative retry budget is a deadline in the past -- both are stored
   * values a parser should refuse and report rather than pass on to a client
   * that will behave inexplicably.
   */
  min?: number;
}

export const POLICY_FIELDS = {
  /** Resolved to 'en' by the global layer and read by nothing. */
  language: { kind: 'text', label: 'Language', settable: false },
  /**
   * One, everywhere, and not a number anyone can usefully change.
   *
   * The app's own single-flight guard is stricter than any policy value, so an
   * override would be inert here whatever a backend could do. That alone
   * settles it, and it is the half this repo can assert against.
   *
   * The other half is a claim about someone else's process and is recorded as
   * one: the heylook side reports one generation at a time process-wide, from
   * reading its own source rather than from a measurement, and says no endpoint
   * publishes a slot count to discover otherwise from. Nothing here can check
   * that, so it is a reason to leave this alone rather than a fact to build on
   * -- and if it were wrong, the single-flight guard would still be the binding
   * constraint. Both halves would have to change before this becomes a control.
   */
  maxConcurrentRequests: { kind: 'integer', label: 'Concurrent requests', min: 1, settable: false },
  /**
   * The one attribute with teeth: `heylookPolicyConfig` maps it to the heylook
   * client's `backpressureBudgetMs`, which bounds the 503 retry loop. Worth
   * setting per machine because it is calibrated to how long a generation takes
   * there, and heylook's `Retry-After: 1` is a fixed literal rather than an
   * estimate, so the budget is the only thing deciding when to give up.
   */
  retryTimeoutMs: { kind: 'duration-ms', label: 'Retry budget', min: 0, settable: true },
  /** Resolved per provider type and read by nothing. */
  typicalCallMs: { kind: 'duration-ms', label: 'Typical call', min: 0, settable: false },
} as const satisfies Record<keyof Policy, PolicyField>;
