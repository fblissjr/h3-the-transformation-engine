/**
 * The stored half of the settings cascade.
 *
 * Two properties, and they pull in opposite directions. A stored override has
 * to be refused when it is nonsense, because it reaches a live client -- a
 * negative retry budget is a deadline in the past. And it has to be tolerated
 * when it is merely unfamiliar, because storage outlives the build that wrote
 * it and a build that will not open what the last one saved loses settings that
 * exist nowhere else.
 *
 * Written against `fake-indexeddb` rather than a mock, so a round trip is a
 * real one.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const { closeDb, getSetting, setSetting } = await import('../src/db/db');
const { INSTANCE_POLICY_SETTING, loadInstancePolicies, parseStoredPolicies, setInstanceAttribute } =
  await import('../src/db/policy');
const { POLICY_FIELDS, POLICY_KEYS } = await import('../src/core/policy');

beforeEach(async () => {
  closeDb();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('H3TransformationEngine');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe('every attribute is answered for, by construction', () => {
  it('gives each policy key a field, in both directions', () => {
    // `satisfies Record<keyof Policy, PolicyField>` already fails the build for
    // a missing or a surplus entry, so this is the runtime restatement of a
    // compile-time guarantee -- kept because the table drives a parser and a
    // renderer, and a green suite that never touched either would not say so.
    expect(Object.keys(POLICY_FIELDS).sort()).toEqual([...POLICY_KEYS].sort());
  });

  it('marks exactly the attributes something reads as settable', () => {
    // The claim this pins is not "one is settable" but "settable means a
    // consumer exists". `retryTimeoutMs` reaches `backpressureBudgetMs`; the
    // other three are read by nothing in src/, which is why they are shown and
    // not offered. Flipping one to true without wiring a consumer turns this
    // red, which is the point -- it is the guard against a panel of controls
    // that do nothing.
    const settable = POLICY_KEYS.filter((key) => POLICY_FIELDS[key].settable);
    expect(settable).toEqual(['retryTimeoutMs']);
  });
});

describe('parsing refuses nonsense and tolerates the unfamiliar', () => {
  it('keeps a well-formed override', () => {
    expect(parseStoredPolicies({ studio: { retryTimeoutMs: 9_000 } })).toEqual({
      policies: { studio: { retryTimeoutMs: 9_000 } },
    });
  });

  it('drops an attribute below the floor its field declares, and says which machine', () => {
    // maxConcurrentRequests has min 1: zero is a backend nobody can call.
    const result = parseStoredPolicies({ studio: { maxConcurrentRequests: 0 } });
    expect(result.policies.studio).toBeUndefined();
    expect(result.error).toContain('studio');
  });

  it('drops an override of the wrong type rather than handing it to a client', () => {
    const result = parseStoredPolicies({ studio: { retryTimeoutMs: '9000' } });
    expect(result.policies.studio).toBeUndefined();
    expect(result.error).toBeDefined();
  });

  it('keeps the machines that parsed when one did not', () => {
    // Per-entry rather than whole-bag: one bad machine must not take the
    // others' settings with it.
    const result = parseStoredPolicies({
      good: { retryTimeoutMs: 9_000 },
      bad: { retryTimeoutMs: -1 },
    });
    expect(result.policies.good).toEqual({ retryTimeoutMs: 9_000 });
    expect(result.policies.bad).toBeUndefined();
    expect(result.error).toContain('bad');
    expect(result.error).not.toContain('good');
  });

  it('keeps an attribute a later build knew about, dropping only the unknown key', () => {
    // The tolerance that matters. A build that refused this would lose the
    // retry budget because a newer one had also stored something else.
    const result = parseStoredPolicies({ studio: { retryTimeoutMs: 9_000, somethingNewer: 3 } });
    expect(result.policies.studio).toEqual({ retryTimeoutMs: 9_000 });
    expect(result.error).toBeUndefined();
  });

  it('reports a bag that is not a bag rather than throwing', () => {
    expect(parseStoredPolicies(['not', 'an', 'object']).error).toBeDefined();
    expect(parseStoredPolicies(null)).toEqual({ policies: {} });
  });
});

describe('a round trip through storage', () => {
  it('stores an override and reads it back', async () => {
    const written = await setInstanceAttribute('studio', 'retryTimeoutMs', 9_000);
    expect(written.policies).toEqual({ studio: { retryTimeoutMs: 9_000 } });
    expect((await loadInstancePolicies()).policies).toEqual({ studio: { retryTimeoutMs: 9_000 } });
  });

  it('removes the entry when its last attribute is cleared, rather than storing an empty one', async () => {
    // `{}` and no entry must not be two states, or the panel reports a machine
    // as customised to exactly its inherited values. Asserted against what
    // storage actually holds, not against the returned bag.
    await setInstanceAttribute('studio', 'retryTimeoutMs', 9_000);
    const cleared = await setInstanceAttribute('studio', 'retryTimeoutMs', undefined);
    expect(cleared.policies).toEqual({});
    expect(await getSetting(INSTANCE_POLICY_SETTING, null)).toEqual({});
  });

  it('leaves other machines alone when one is written', async () => {
    await setInstanceAttribute('other', 'retryTimeoutMs', 1_000);
    const next = await setInstanceAttribute('studio', 'retryTimeoutMs', 9_000);
    expect(next.policies).toEqual({
      other: { retryTimeoutMs: 1_000 },
      studio: { retryTimeoutMs: 9_000 },
    });
  });

  it('refuses a value below its declared floor instead of storing it', async () => {
    // The control enforced nothing, so -5000 reached the client as a retry
    // deadline already in the past, and only surfaced on the NEXT load -- where
    // it read as storage being corrupt rather than as the control that wrote
    // it. Validating on read and not on write is not a boundary.
    const written = await setInstanceAttribute('studio', 'retryTimeoutMs', -5_000);
    expect(written.rejected).toBeDefined();
    expect(await getSetting(INSTANCE_POLICY_SETTING, null)).toBeNull();
  });

  it('keeps an entry this build cannot parse when a different machine is written', async () => {
    // The write path used to round-trip the PARSED bag, so an override this
    // build rejects was destroyed the next time any other machine was edited --
    // while the load site's comment promised the opposite in as many words.
    // Merging into the raw stored value is what that promise actually requires.
    await setSetting(INSTANCE_POLICY_SETTING, {
      fromALaterBuild: { retryTimeoutMs: 'not a number' },
    });
    await setInstanceAttribute('studio', 'retryTimeoutMs', 9_000);
    const raw = (await getSetting<unknown>(INSTANCE_POLICY_SETTING, null)) as Record<string, unknown>;
    expect(raw.fromALaterBuild).toEqual({ retryTimeoutMs: 'not a number' });
    expect(raw.studio).toEqual({ retryTimeoutMs: 9_000 });
  });

  it('merges into what storage holds rather than into a caller-held bag', async () => {
    // Two attributes written without the caller re-reading in between. A
    // whole-policy setter built from a stale prop drops the first.
    await setInstanceAttribute('studio', 'retryTimeoutMs', 9_000);
    await setInstanceAttribute('studio', 'typicalCallMs', 4_000);
    expect((await loadInstancePolicies()).policies.studio).toEqual({
      retryTimeoutMs: 9_000,
      typicalCallMs: 4_000,
    });
  });
});
