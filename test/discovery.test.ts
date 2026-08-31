/**
 * The roster's transition table.
 *
 * This file exists because of where the defect it covers used to live. The
 * staleness guard and the asked/failed distinction were both properties of
 * `useEngine`, and there is no React renderer in the devDependencies, so
 * nothing could reach them: deleting either left the whole suite green and the
 * screen looking correct, and the fault appeared only when a person switched
 * instances quickly or ran against a server that was still starting up.
 *
 * Moving the decision into `src/provider/heylook/discovery.ts` is what these
 * assertions are for. What breaks if this file is deleted: a reply from a
 * machine the user has switched away from can overwrite the roster of the one
 * they are on, and a failed discovery can go back to being a state that either
 * never retries or retries forever.
 *
 * The equality inside the guard is not the interesting part -- CLAUDE.md is
 * right that asserting `a === b` through a wrapper proves nothing. The
 * interesting part is the table: which events are accepted in which state, and
 * that `unasked` and `failed` are two states rather than one.
 */

import { describe, expect, it } from 'vitest';
import {
  INITIAL_ROSTER,
  isDiscovering,
  reduceRoster,
  rosterError,
  rosterModels,
  shouldDiscover,
  type RosterState,
} from '../src/provider/heylook/discovery';
import type { HeylookModel } from '../src/provider/heylook/models';

const ORIGIN = 'http://heylook.test';
const MODELS_A: HeylookModel[] = [{ id: 'model-on-a', provider: 'mlx' }];
const MODELS_B: HeylookModel[] = [{ id: 'model-on-b', provider: 'mlx' }];

/** The state after a discovery has been started for `instanceId`. */
function asking(instanceId: string): RosterState {
  return reduceRoster(INITIAL_ROSTER, { type: 'ask', instanceId });
}

describe('a reply is only accepted from the machine that was asked', () => {
  it('drops a roster belonging to an instance that is no longer in flight', () => {
    // The reported defect, in the order it happens: discovery starts for A,
    // the user switches to B, discovery restarts for B, and A -- the slower
    // machine -- answers last. Before the split this wrote unconditionally,
    // so the picker listed A's models while every call went to B.
    const afterSwitch = reduceRoster(asking('a'), { type: 'reset' });
    const askingB = reduceRoster(afterSwitch, { type: 'ask', instanceId: 'b' });

    const late = reduceRoster(askingB, { type: 'resolved', instanceId: 'a', models: MODELS_A });

    expect(late).toBe(askingB);
    expect(rosterModels(late)).toBeNull();
  });

  it('accepts the reply from the instance that is in flight', () => {
    // The other half, and the one that says the guard is not simply refusing
    // everything: the same call shape with a matching id must get through, or
    // the test above would pass against a function that dropped all replies.
    const state = reduceRoster(asking('b'), {
      type: 'resolved',
      instanceId: 'b',
      models: MODELS_B,
    });

    expect(state.kind).toBe('ready');
    expect(rosterModels(state)).toEqual(MODELS_B);
  });

  it('drops an error belonging to an instance that is no longer in flight', () => {
    // The error path carries the same risk and is easier to miss, because a
    // stale failure is not obviously wrong on screen -- it just names a
    // machine you are not on.
    const askingB = reduceRoster(
      reduceRoster(asking('a'), { type: 'reset' }),
      { type: 'ask', instanceId: 'b' },
    );

    const late = reduceRoster(askingB, { type: 'failed', instanceId: 'a', error: 'a is down' });

    expect(late).toBe(askingB);
    expect(rosterError(late, ORIGIN)).toBeNull();
  });

  it('drops an outcome that arrives when nothing is in flight', () => {
    // Distinct from the stale-instance case and worth its own control: a reset
    // during a discovery for the SAME instance -- an erase, say -- must not be
    // undone by the reply it was racing. Guarding only on the id would let
    // this one through.
    const afterReset = reduceRoster(asking('a'), { type: 'reset' });

    const late = reduceRoster(afterReset, {
      type: 'resolved',
      instanceId: 'a',
      models: MODELS_A,
    });

    expect(late).toBe(afterReset);
    expect(shouldDiscover(late)).toBe(true);
  });
});

describe('a failure is sticky, and is cleared only by a gesture', () => {
  it('does not ask again on its own', () => {
    // The second reported defect. The error path used to write `[]` while the
    // effect gated on `!= null`, so a failure satisfied the gate and the
    // roster never healed. Making it fail the gate is the fix; making it fail
    // the gate WITHOUT being re-asked automatically is what stops the effect,
    // which depends on this state, from becoming a retry loop.
    const failed = reduceRoster(asking('a'), {
      type: 'failed',
      instanceId: 'a',
      error: 'server is not running',
    });

    expect(shouldDiscover(failed)).toBe(false);
    expect(rosterError(failed, ORIGIN)).toBe('server is not running');
  });

  it('is distinguishable from having asked nothing', () => {
    // The distinction the old code could not express. Both of these show no
    // models; only one of them should discover.
    expect(rosterModels(INITIAL_ROSTER)).toBeNull();
    expect(shouldDiscover(INITIAL_ROSTER)).toBe(true);

    const failed = reduceRoster(asking('a'), { type: 'failed', instanceId: 'a', error: 'down' });
    expect(rosterModels(failed)).toBeNull();
    expect(shouldDiscover(failed)).toBe(false);
  });

  it('is cleared by selecting the provider again', () => {
    // The recovery gesture for the case that motivated all of this: a server
    // that was still starting up. Without this, the only way back is the
    // refresh button, which sits inside the panel reporting the failure.
    const failed = reduceRoster(asking('a'), { type: 'failed', instanceId: 'a', error: 'down' });

    const reconsidered = reduceRoster(failed, { type: 'reconsider' });

    expect(shouldDiscover(reconsidered)).toBe(true);
  });

  it('is cleared by switching machine', () => {
    const failed = reduceRoster(asking('a'), { type: 'failed', instanceId: 'a', error: 'down' });

    expect(shouldDiscover(reduceRoster(failed, { type: 'reset' }))).toBe(true);
  });

  it('is cleared by asking again directly, which is the refresh button', () => {
    const failed = reduceRoster(asking('a'), { type: 'failed', instanceId: 'a', error: 'down' });

    const retried = reduceRoster(failed, { type: 'ask', instanceId: 'a' });

    expect(isDiscovering(retried)).toBe(true);
    expect(rosterError(retried, ORIGIN)).toBeNull();
  });
});

describe('reconsider cannot disturb a discovery that is working', () => {
  // It fires from `setProvider`, which a person can press at any moment. If it
  // reset an in-flight ask, choosing heylook twice would abandon the discovery
  // already running and the effect would start a second one.
  it('leaves an in-flight ask alone', () => {
    const inFlight = asking('a');
    expect(reduceRoster(inFlight, { type: 'reconsider' })).toBe(inFlight);
  });

  it('leaves a good roster alone', () => {
    const ready = reduceRoster(asking('a'), {
      type: 'resolved',
      instanceId: 'a',
      models: MODELS_A,
    });
    expect(reduceRoster(ready, { type: 'reconsider' })).toBe(ready);
  });

  it('returns the same value when there is nothing to clear', () => {
    // Reference equality rather than deep equality on purpose: this is what
    // lets React bail out of the re-render. A `reconsider` that returned a
    // fresh `unasked` object every time would re-run the effect that depends
    // on this state.
    expect(reduceRoster(INITIAL_ROSTER, { type: 'reconsider' })).toBe(INITIAL_ROSTER);
    expect(reduceRoster(INITIAL_ROSTER, { type: 'reset' })).toBe(INITIAL_ROSTER);
  });
});

describe('an empty roster is an answer, not a failure', () => {
  it('reports the empty case without failing the state', () => {
    // These were one value before -- the empty roster wrote both `[]` and an
    // error string -- which is the same conflation as `unasked` versus
    // `failed`, one layer up. A server serving nothing has answered, so it
    // must not be re-asked in a loop and must not look unreachable.
    const empty = reduceRoster(asking('a'), { type: 'resolved', instanceId: 'a', models: [] });

    expect(empty.kind).toBe('ready');
    expect(rosterModels(empty)).toEqual([]);
    expect(shouldDiscover(empty)).toBe(false);
    expect(rosterError(empty, ORIGIN)).toContain('serving no models');
  });

  it('says nothing when the roster has something in it', () => {
    const ready = reduceRoster(asking('a'), {
      type: 'resolved',
      instanceId: 'a',
      models: MODELS_A,
    });
    expect(rosterError(ready, ORIGIN)).toBeNull();
  });
});

describe('the indicator follows the ask, not the app', () => {
  it('is on only while a discovery is in flight', () => {
    // `discovering` disables the refresh button and puts "asking ..." on
    // screen. It used to be cleared in a `finally`, so the slower of two
    // discoveries turned the indicator off while the newer one was still
    // running and left the panel looking idle mid-discovery.
    expect(isDiscovering(INITIAL_ROSTER)).toBe(false);
    expect(isDiscovering(asking('a'))).toBe(true);

    const askingB = reduceRoster(
      reduceRoster(asking('a'), { type: 'reset' }),
      { type: 'ask', instanceId: 'b' },
    );
    const staleFinish = reduceRoster(askingB, {
      type: 'resolved',
      instanceId: 'a',
      models: MODELS_A,
    });

    expect(isDiscovering(staleFinish)).toBe(true);
  });
});
