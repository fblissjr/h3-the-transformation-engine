/**
 * The settings cascade.
 *
 * Two properties carry the design and the rest follow from them: resolution is
 * per attribute rather than per layer, and precedence is the order of `SCOPES`
 * rather than a number stored anywhere. The first is what lets a provider
 * override concurrency without losing the global language; the second is what
 * makes inserting a level a one-line change instead of a migration.
 *
 * The structural tests at the bottom are the ones that matter in a year: they
 * assert that adding a scope or an attribute needs no edit here, so a future
 * change is caught by compilation rather than by these tests going stale.
 */

import { describe, expect, it } from 'vitest';
import {
  explainPolicy,
  layersFrom,
  POLICY_KEYS,
  PROVIDER_TYPE_POLICY,
  PROVIDER_TYPES,
  resolveAttribute,
  resolvePolicy,
  SCOPES,
  GLOBAL_POLICY,
  type PolicyLayers,
} from '../src/core/policy';

describe('the cascade resolves per attribute, not per layer', () => {
  const layers: PolicyLayers = {
    global: { language: 'en', retryTimeoutMs: 1000, typicalCallMs: 100 },
    providerType: { maxConcurrentRequests: 1, retryTimeoutMs: 300_000 },
    provider: { typicalCallMs: 50_000 },
    instance: { maxConcurrentRequests: 4 },
  };

  it('takes each attribute from the most specific layer that states it', () => {
    expect(resolvePolicy(layers)).toEqual({
      language: 'en', // only global says it
      maxConcurrentRequests: 4, // instance beats providerType
      retryTimeoutMs: 300_000, // providerType beats global
      typicalCallMs: 50_000, // provider beats global
    });
  });

  it('does not let a lower layer drop attributes it says nothing about', () => {
    // The classic failure: treating layers as alternative configurations, so
    // the most specific one replaces the whole object and everything it did not
    // mention disappears. Here the instance states one attribute and the other
    // three must survive.
    const resolved = resolvePolicy(layers);
    expect(resolved.language).toBe('en');
    expect(Object.keys(resolved).sort()).toEqual([...POLICY_KEYS].sort());
  });

  it('reports which scope supplied each value', () => {
    // "Why is this 1?" is the only question anyone asks of a cascade.
    const explained = explainPolicy(layers);
    expect(explained.maxConcurrentRequests).toEqual({ value: 4, scope: 'instance' });
    expect(explained.retryTimeoutMs).toEqual({ value: 300_000, scope: 'providerType' });
    expect(explained.language).toEqual({ value: 'en', scope: 'global' });
  });

  it('says nothing rather than inventing a default when no layer states a value', () => {
    // An invented default would be indistinguishable from a configured one,
    // which is worse than absent -- the caller knows what its own fallback
    // should be and can say so.
    expect(resolvePolicy({})).toEqual({});
    expect(resolveAttribute({}, 'language')).toBeNull();
    expect(explainPolicy({})).toEqual({});
  });

  it('treats an empty layer as no opinion, not as an override to undefined', () => {
    // An empty object at a specific scope must not shadow the layers below it.
    // This is reachable: a provider with nothing to say is naturally `{}`.
    const withEmpty: PolicyLayers = { global: { language: 'fr' }, instance: {}, provider: {} };
    expect(resolvePolicy(withEmpty).language).toBe('fr');
    expect(layersFrom(withEmpty)).toEqual({ global: { language: 'fr' } });
  });

  it('distinguishes a falsy value from an absent one', () => {
    // 0 is a legal concurrency answer in principle and a legal typicalCallMs,
    // so a truthiness check here would silently fall through to the next layer.
    const layered: PolicyLayers = {
      global: { maxConcurrentRequests: 8, typicalCallMs: 100 },
      instance: { maxConcurrentRequests: 0, typicalCallMs: 0 },
    };
    expect(resolvePolicy(layered).maxConcurrentRequests).toBe(0);
    expect(resolveAttribute(layered, 'typicalCallMs')).toEqual({ value: 0, scope: 'instance' });
  });
});

describe('precedence is the scope order, and nothing stores a level number', () => {
  it('runs most specific to least specific', () => {
    expect(SCOPES).toEqual(['instance', 'provider', 'providerType', 'global']);
  });

  it('resolves through every scope in that order, whatever the order becomes', () => {
    // Derived from SCOPES rather than hand-listed, so inserting a level makes
    // this cover it automatically. Each scope in turn is the only one stating
    // the attribute, and each must win when it is the most specific present.
    for (let i = 0; i < SCOPES.length; i += 1) {
      const layers: PolicyLayers = {};
      // Every scope from i outward states a distinct value.
      for (let j = i; j < SCOPES.length; j += 1) {
        layers[SCOPES[j]] = { maxConcurrentRequests: j };
      }
      const found = resolveAttribute(layers, 'maxConcurrentRequests');
      expect(found, `most specific present is ${SCOPES[i]}`).toEqual({ value: i, scope: SCOPES[i] });
    }
  });
});

describe('a provider type is a bundle of defaults, never a thing to branch on', () => {
  it('gives every declared type a policy, without this test naming them', () => {
    // Derived from PROVIDER_TYPES, so adding a third type fails here until it
    // has defaults -- rather than silently resolving to nothing at that layer.
    for (const type of PROVIDER_TYPES) {
      expect(PROVIDER_TYPE_POLICY[type], type).toBeDefined();
      expect(Object.keys(PROVIDER_TYPE_POLICY[type]).length, type).toBeGreaterThan(0);
    }
  });

  it('leaves the machine-specific attribute overridable, which is the whole point', () => {
    // The motivating case: the same self-operated software on two machines. One
    // serialises generation, the other could batch. The type default is the
    // conservative one and the instance corrects it.
    const studio = resolvePolicy({
      global: GLOBAL_POLICY,
      providerType: PROVIDER_TYPE_POLICY['self-operated'],
      instance: { maxConcurrentRequests: 1 },
    });
    const workstation = resolvePolicy({
      global: GLOBAL_POLICY,
      providerType: PROVIDER_TYPE_POLICY['self-operated'],
      instance: { maxConcurrentRequests: 4 },
    });
    expect(studio.maxConcurrentRequests).toBe(1);
    expect(workstation.maxConcurrentRequests).toBe(4);
    // And they still agree on everything the type does state.
    expect(studio.retryTimeoutMs).toBe(workstation.retryTimeoutMs);
    expect(studio.language).toBe(workstation.language);
  });

  it('does not state concurrency globally, because it is not a global fact', () => {
    // A global default here would be a guess applied to every backend, and the
    // cascade exists precisely because this value is known per machine.
    expect(GLOBAL_POLICY.maxConcurrentRequests).toBeUndefined();
  });
});

describe('the shape is extensible without editing this file', () => {
  it('resolves every declared attribute, however many there are', () => {
    // POLICY_KEYS is `satisfies readonly (keyof Policy)[]`, so a new attribute
    // that is not listed there fails to compile rather than being silently
    // unresolvable. This asserts the runtime half: everything listed resolves.
    const all: PolicyLayers = { global: Object.fromEntries(POLICY_KEYS.map((k) => [k, 1])) };
    expect(Object.keys(resolvePolicy(all)).sort()).toEqual([...POLICY_KEYS].sort());
  });

  it('carries no attribute the Policy type does not declare', () => {
    // Guards the other direction: a key left in POLICY_KEYS after being removed
    // from Policy would resolve to a value nothing reads.
    const layers: PolicyLayers = { global: { language: 'en' }, instance: { nonsense: 1 } as never };
    expect(resolvePolicy(layers)).toEqual({ language: 'en' });
  });
});
