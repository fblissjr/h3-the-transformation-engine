/**
 * The bridge between the cascade and the clients.
 *
 * `core/policy` knows the mechanism and no backends; the clients know one
 * backend each and no mechanism. Everything provider-specific is data in
 * `src/provider/registry.ts`, and these are the properties that make that
 * separation hold rather than merely look tidy.
 */

import { describe, expect, it } from 'vitest';
import {
  allOrigins,
  explainFor,
  layersFor,
  describeConcurrency,
  heylookPolicyConfig,
  instanceFor,
  instancePolicyFor,
  HEYLOOK_INSTANCES,
  parseInstances,
  policyFor,
  PROVIDERS,
} from '../src/provider/registry';
import { PROVIDER_TYPES } from '../src/core/policy';

describe('providers declare a type and nothing branches on it', () => {
  it('gives every provider a declared type', () => {
    for (const [id, descriptor] of Object.entries(PROVIDERS)) {
      expect(descriptor.id, id).toBe(id);
      expect(PROVIDER_TYPES, id).toContain(descriptor.type);
    }
  });

  it('does not pin a machine fact onto the provider that happens to run there', () => {
    // The motivating mistake: heylook currently runs on a box that serialises
    // generation, so it is tempting to put maxConcurrentRequests: 1 on the
    // heylook descriptor. That would make every future instance inherit one
    // machine's limitation, including a box with a discrete GPU that could
    // batch. It belongs to the instance, and this asserts it is not there.
    expect(PROVIDERS.heylook.policy?.maxConcurrentRequests).toBeUndefined();
    expect(PROVIDERS.gemini.policy?.maxConcurrentRequests).toBeUndefined();
  });

  it('resolves a usable policy for every provider with no instance overrides', () => {
    for (const id of Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]) {
      const policy = policyFor(id);
      expect(policy.language, id).toBeDefined();
      expect(policy.retryTimeoutMs, id).toBeGreaterThan(0);
      expect(policy.maxConcurrentRequests, id).toBeGreaterThan(0);
    }
  });

  it('lets an instance override the type default, and says so', () => {
    // The two-machines case, resolved end to end rather than in the abstract.
    const studio = policyFor('heylook', { maxConcurrentRequests: 1 });
    const workstation = policyFor('heylook', { maxConcurrentRequests: 4 });
    expect(studio.maxConcurrentRequests).toBe(1);
    expect(workstation.maxConcurrentRequests).toBe(4);

    const explained = explainFor('heylook', { maxConcurrentRequests: 4 });
    expect(explained.maxConcurrentRequests?.scope).toBe('instance');
    expect(explained.retryTimeoutMs?.scope).toBe('providerType');
    expect(explained.language?.scope).toBe('global');
  });

  it('gives the two provider types genuinely different retry budgets', () => {
    // If these were equal the type layer would be decoration. A hosted endpoint
    // that refuses is rate-limiting; a local one that refuses is queueing, and
    // waiting five minutes is only sensible for the second.
    expect(policyFor('heylook').retryTimeoutMs).toBeGreaterThan(
      policyFor('gemini').retryTimeoutMs!,
    );
  });

  it('omits the provider layer entirely when a provider has nothing to add', () => {
    // Rather than inserting an empty object, which would read as "this provider
    // has an opinion" to anyone looking at the layers.
    expect(layersFor('gemini').provider).toBeUndefined();
  });
});

describe('the stored bag reaches the cascade, or the instance layer is decoration', () => {
  const heylook = HEYLOOK_INSTANCES[0];
  const stored = { [heylook.id]: { retryTimeoutMs: 9_000 } };

  it('spans a stored override through to the client option it becomes', () => {
    // The whole thread in one assertion, because every link in it was
    // separately correct while the chain reached nothing: the bag is keyed by
    // instance id, the cascade takes one layer, and the client takes a
    // millisecond budget. What this cannot reach is `useEngine` handing the bag
    // over -- the same irreducible remainder `buildClient` has, and the reason
    // `instancePolicyFor` is a named function rather than three lines in a memo.
    const policy = policyFor('heylook', instancePolicyFor('heylook', heylook, stored));
    expect(heylookPolicyConfig(policy)).toEqual({ backpressureBudgetMs: 9_000 });
  });

  it('reports the stored value as coming from the machine, not from a default', () => {
    // A panel that cannot tell inherited from set-here cannot offer a reset,
    // which is the only reason `explainPolicy` returns a scope at all.
    const explained = explainFor('heylook', instancePolicyFor('heylook', heylook, stored));
    expect(explained.retryTimeoutMs?.scope).toBe('instance');
    expect(explained.maxConcurrentRequests?.scope).toBe('providerType');
  });

  it('withholds the overrides of a machine a provider does not serve', () => {
    // Instances are heylook's today. A Gemini call inheriting a local box's
    // five-minute retry budget would be a hosted endpoint queueing for minutes
    // behind a quota that resets in seconds. Keyed on the instance's own
    // providerId rather than on the string 'heylook', so a provider that gains
    // instances later needs no edit here.
    expect(instancePolicyFor('gemini', heylook, stored)).toEqual({});
    expect(policyFor('gemini', instancePolicyFor('gemini', heylook, stored)).retryTimeoutMs).toBe(
      policyFor('gemini').retryTimeoutMs,
    );
  });

  it('ignores overrides stored against a machine this build no longer configures', () => {
    // Origins are build-time, so an id can outlive the environment that named
    // it. Matching how a stored instance CHOICE is dropped when the environment
    // stops naming it -- kept in storage, absent from the cascade.
    expect(instancePolicyFor('heylook', heylook, { 'a-machine-that-left': { retryTimeoutMs: 1 } }))
      .toEqual({});
  });
});

describe('policy reaches the client, or it is decoration', () => {
  it('maps the retry budget onto the client option that consumes it', () => {
    expect(heylookPolicyConfig(policyFor('heylook'))).toEqual({
      backpressureBudgetMs: policyFor('heylook').retryTimeoutMs,
    });
  });

  it('carries an instance override through to the client option', () => {
    // The end-to-end claim: a value stated for one machine changes what that
    // machine's client is constructed with.
    expect(heylookPolicyConfig(policyFor('heylook', { retryTimeoutMs: 9_000 }))).toEqual({
      backpressureBudgetMs: 9_000,
    });
  });

  it('says nothing when policy states nothing, leaving the client its default', () => {
    expect(heylookPolicyConfig({})).toEqual({});
  });

  it('does not claim concurrency is enforced, because it is not', () => {
    // An attribute that looks like a limit and is not is worse than an absent
    // one. The app's own single-flight guard is stricter than any policy value,
    // so this describes rather than gates -- and the description says so.
    expect(describeConcurrency({ maxConcurrentRequests: 4 })).toMatch(/one call at a time/);
    expect(describeConcurrency({ maxConcurrentRequests: 1 })).toMatch(/1 call at a time/);
  });
});

describe('instances are configured at build time, because the CSP names them', () => {
  it('parses a named list', () => {
    const parsed = parseInstances('studio=http://a.local:8000,rtx=http://b.local:9000', undefined);
    expect(parsed.map((i) => [i.id, i.origin])).toEqual([
      ['studio', 'http://a.local:8000'],
      ['rtx', 'http://b.local:9000'],
    ]);
  });

  it('normalizes each origin the same way the policy entry is normalized', () => {
    // A trailing slash here and not in `connect-src` would refuse the request
    // with no status -- the failure this whole arrangement exists to prevent.
    expect(parseInstances('a=http://x.local:8000/', undefined)[0].origin).toBe('http://x.local:8000');
  });

  it('still honours a single bare origin, which is what shipped', () => {
    const parsed = parseInstances(undefined, 'http://127.0.0.1:42193');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].origin).toBe('http://127.0.0.1:42193');
  });

  it('names an unnamed entry after itself rather than dropping it', () => {
    // Silently dropping a malformed entry loses a machine, and the symptom is
    // an instance that is simply missing from the picker with no explanation.
    const parsed = parseInstances('http://solo.local:8000', undefined);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].origin).toBe('http://solo.local:8000');
  });

  it('falls back rather than producing an empty list', () => {
    expect(parseInstances('', undefined)).toHaveLength(1);
    expect(parseInstances('  ,  ', undefined)).toHaveLength(1);
  });

  it('resolves an origin only from the list connect-src is generated from', () => {
    // The invariant, asserted rather than described. It was broken by the
    // commit that introduced instances: connect-src was generated from
    // parseInstances while the client still read HEYLOOK_ORIGIN directly, so
    // setting VITE_HEYLOOK_INSTANCES to another host produced a policy naming
    // one machine and a client fetching another -- refused by the browser with
    // no status and no body. Every origin a client can be built with has to be
    // one the policy names.
    const reachable = [
      ...HEYLOOK_INSTANCES.map((i) => instanceFor(i.id).origin),
      instanceFor(null).origin,
      instanceFor('no-such-instance').origin,
    ];
    for (const origin of reachable) {
      expect(allOrigins(), origin).toContain(origin);
    }
  });

  it('falls back to a configured instance rather than inventing one', () => {
    // A stored id naming a machine this build no longer configures must land on
    // something in the policy, not on a remembered origin outside it.
    expect(HEYLOOK_INSTANCES).toContainEqual(instanceFor('gone'));
    expect(HEYLOOK_INSTANCES).toContainEqual(instanceFor(null));
  });

  it('reports every distinct origin, which is what connect-src must carry', () => {
    // The same list the vite plugin writes into the policy. Duplicates collapse
    // so two names for one box do not produce a repeated source.
    const instances = parseInstances('a=http://x:1,b=http://y:2,c=http://x:1', undefined);
    expect(allOrigins(instances)).toEqual(['http://x:1', 'http://y:2']);
  });
});
