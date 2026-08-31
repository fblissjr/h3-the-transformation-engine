/**
 * The roster's lifecycle, as a value.
 *
 * Discovery is asynchronous and its subject can change while it is in flight:
 * instance origins are build-time but which one is current is not, so a reply
 * can arrive describing a machine the user has since switched away from. This
 * module is the transition table for that, kept out of the hook on purpose.
 *
 * Why a module rather than two lines in `useEngine`: the guard that discards a
 * stale reply is the kind that stops working silently -- delete it and the
 * suite stays green, the screen looks right, and the fault appears only when
 * two instances are switched quickly. There is no React renderer in the
 * devDependencies, so anything living in the hook is unreachable by
 * construction. Moving the decision into a pure function is the same move the
 * version counter made when it started deriving the next id from storage
 * instead of from module state: change the design so the property becomes
 * testable, rather than build a harness that can reach the old design.
 *
 * The non-obvious half is not the staleness compare, which is an equality. It
 * is that `unasked` and `failed` are different states. They were one value
 * before this -- a failed discovery wrote `[]`, the re-discovery effect gated
 * on `!= null`, and so an empty array both satisfied the gate and meant
 * nothing was there. A server that was still starting up produced a roster
 * that never healed, because the only state that could ask again had been
 * overwritten by the answer. Splitting them is what `shouldDiscover` reads.
 */

import type { HeylookModel } from './models';

/**
 * What is known about the roster.
 *
 * Every variant but `unasked` names the instance it describes, because a
 * roster with no machine attached is exactly the value that let one machine's
 * models be shown while every call went to another.
 */
export type RosterState =
  /** Nothing has been asked for the current instance. The only state that discovers. */
  | { kind: 'unasked' }
  | { kind: 'asking'; instanceId: string }
  | { kind: 'ready'; instanceId: string; models: HeylookModel[] }
  /**
   * Asked, and the server did not answer. Deliberately sticky: it does not
   * satisfy `shouldDiscover`, because a state the effect re-fires on is an
   * unbounded retry loop against a machine that is down. It is cleared by a
   * gesture instead -- see `reduceRoster`.
   */
  | { kind: 'failed'; instanceId: string; error: string };

export type RosterEvent =
  /** Discovery has started for this instance. */
  | { type: 'ask'; instanceId: string }
  | { type: 'resolved'; instanceId: string; models: HeylookModel[] }
  | { type: 'failed'; instanceId: string; error: string }
  /** The subject changed, or storage was erased. Back to knowing nothing. */
  | { type: 'reset' }
  /**
   * The user did something that reads as "try again": selecting heylook in the
   * provider picker. Clears a failure and nothing else, so it is safe to fire
   * on a state that is mid-flight or already good.
   */
  | { type: 'reconsider' };

export const INITIAL_ROSTER: RosterState = { kind: 'unasked' };

/**
 * The only state that should start a discovery.
 *
 * `failed` is excluded on purpose and that is the whole point of the split:
 * the effect that calls discovery depends on this state, so a failure that
 * asked again would ask forever.
 */
export function shouldDiscover(state: RosterState): boolean {
  return state.kind === 'unasked';
}

/**
 * Apply an event.
 *
 * Returns the state unchanged -- by reference, which is what lets React bail
 * out of the re-render -- whenever the event does not apply. Two cases do not
 * apply and they are different: an outcome for an instance that is no longer
 * being asked about is stale and dropped, and an outcome arriving when nothing
 * is in flight has already been superseded by a reset.
 */
export function reduceRoster(state: RosterState, event: RosterEvent): RosterState {
  switch (event.type) {
    case 'ask':
      return { kind: 'asking', instanceId: event.instanceId };

    case 'resolved':
      // Only a live ask can be answered, and only by the instance it asked
      // about. Both halves matter: the first drops a reply that a reset has
      // already made irrelevant, the second drops the slower of two machines.
      if (state.kind !== 'asking' || state.instanceId !== event.instanceId) return state;
      return { kind: 'ready', instanceId: event.instanceId, models: event.models };

    case 'failed':
      if (state.kind !== 'asking' || state.instanceId !== event.instanceId) return state;
      return { kind: 'failed', instanceId: event.instanceId, error: event.error };

    case 'reset':
      return state.kind === 'unasked' ? state : INITIAL_ROSTER;

    case 'reconsider':
      return state.kind === 'failed' ? INITIAL_ROSTER : state;
  }
}

/** The roster to show, or null while there is nothing to show. */
export function rosterModels(state: RosterState): HeylookModel[] | null {
  return state.kind === 'ready' ? state.models : null;
}

/** Whether to say "asking ...". True only for a discovery that is still the current one. */
export function isDiscovering(state: RosterState): boolean {
  return state.kind === 'asking';
}

/**
 * What to tell the user, if anything.
 *
 * An empty roster is not a failure -- the server answered, it just has nothing
 * to serve -- so it is derived here from `ready` rather than stored as an
 * error. Storing it would have made "answered with nothing" and "did not
 * answer" the same value again, one layer up from the bug this module fixes.
 */
export function rosterError(state: RosterState, origin: string): string | null {
  if (state.kind === 'failed') return state.error;
  if (state.kind === 'ready' && state.models.length === 0) {
    return (
      `heylook at ${origin} is running but serving no models. Point it at a model ` +
      'folder, or download one.'
    );
  }
  return null;
}
