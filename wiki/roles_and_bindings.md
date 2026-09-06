# Roles, Instances and Bindings

[Documentation Index](index.md) | [Provider Layer](provider.md) | [Operational Policy](policy.md) | [Architecture](architecture.md) | [UI & State](ui.md)

---

## 1. What this article covers, and its status

This article describes how a model call is addressed: which backend, which
machine, which model, which settings, and which prompt. Three of the four levels
exist in code today. The fourth does not.

Every section below is marked:

- **Implemented** — present in `src/`, with symbols named.
- **Partial** — the structure exists but only one case is populated.
- **Conceptual** — not built. Included because the shape it would take is
  constrained by what is already here, and because knowing that shape prevents
  building something that has to be undone.

Conceptual sections also state whether they fit the current architecture or
require restructuring. None of the ones below require a rewrite of the compiler;
they are additions at the provider and state layers, which is the whole reason
`src/core/` is forbidden to know about any of this.

---

## 2. The four levels

```
provider type      what is true of a backend everywhere        PROVIDERS      implemented
      |
instance           a particular endpoint of that backend       Instance       partial
      |
policy             how to behave toward that endpoint          policyFor      implemented
      |
binding            which of the above a given call uses        --             conceptual
```

The first three are a hierarchy: an instance belongs to exactly one provider
type, and a policy resolves through layers ending at an instance. The fourth is
not part of that hierarchy — it is a mapping from a call site onto it, and one
provider or instance can be named by many bindings.

---

## 3. Provider type — implemented

`ProviderDescriptor` in `src/provider/registry.ts`, keyed by `ProviderId` in the
`PROVIDERS` table. Carries only what is true of a backend on every machine:
`label`, `canEnforceSchema`, and a `ProviderType` (`metered` or
`self-operated`) that selects a bundle of policy defaults.

The table's own comments record why it stays this thin. `maxConcurrentRequests:
1` is deliberately not on the heylook descriptor, because serialised generation
is a fact about the machine it runs on rather than about heylook, and putting it
here would make every future instance inherit one machine's limitation.

That reasoning is the model for everything below: a fact belongs at the narrowest
level that it is true of.

---

## 4. Instance — partial

`Instance` is `{ id, providerId, origin }`. `HEYLOOK_INSTANCES` is built by
`parseInstances` from `VITE_HEYLOOK_INSTANCES` (or a single
`VITE_HEYLOOK_ORIGIN`), `instanceFor` resolves one by id, and `allOrigins`
produces the list that `vite.config.ts` turns into the page's `connect-src`.

**Multiple instances of one provider type already work — for heylook.** Several
named machines can be listed, all of them land in the CSP, and the UI shows a
picker once there is more than one.

What is not there:

- `parseInstances` hardcodes `providerId: 'heylook'`, so there is no way to
  express a second Gemini configuration as an instance. Gemini's per-call
  settings live in a single `GeminiConfig` blob instead.
- Instance origins are build-time by necessity, because the CSP is generated
  from them. See [Provider Layer](provider.md) and the header comment in
  `registry.ts`, which argues that which hosts may be contacted is a build-time
  security decision.
- An instance carries no credential. `HeylookClient` sends only `Content-Type`
  and `X-Request-ID`, so there is no field for a bearer token. This becomes
  load-bearing the moment an instance is reached over a network rather than over
  loopback, because the server's own API key is loopback-exempt by default.

Generalising `Instance` to cover Gemini is a small change and it is the natural
first step toward bindings: an instance is the right unit to hold an endpoint, a
credential reference and a policy, for any backend.

---

## 5. Policy — implemented

`policyFor` resolves a `Policy` through `layersFor`, which stacks provider-type
defaults, provider-level overrides and per-instance overrides, and
`resolvePolicy` in `src/core/policy/resolve.ts` merges them into a `Sourced`
result that records which layer supplied each value.

Instance overrides are the only layer editable at runtime today, stored under the
`instance-policy` key. This is the existing precedent for "structure lives in
code, choices live in storage", and a binding should follow it rather than
inventing a second mechanism.

See [Operational Policy](policy.md) for the layer semantics and the reasons the
resolution reports its own provenance.

---

## 6. Roles — the call sites, and which exist

A role is a distinct job the app asks a model to do. Today the app has three
call sites and no name for the concept.

| Role | Status | Where | Prompts | Notes |
|---|---|---|---|---|
| planner | Implemented | `compile` in `src/pipeline.ts` | `buildPlannerSystemPrompt`, `buildPlannerUserPrompt` | Behind `InferenceClient`. Output is parsed by `PlannerOutputSchema` and becomes a document. |
| patch | Implemented | `edit` in `src/pipeline.ts` | `buildPatchSystemPrompt`, `buildPatchUserPrompt` | Behind `InferenceClient`. Output modifies an existing document. |
| video analysis | Implemented, outside the seam | `analyzeVideoWithGemini` in `src/provider/geminiVideo.ts` | an inline string literal | Gemini only. Does not go through `InferenceClient`, has no entry in `contract.json`, and cannot be configured. |
| image / slot analysis | Conceptual | — | — | Would produce a slot description, which is typed by hand today. Recorded as open work in `CLAUDE.md`. |
| change suggestion | Conceptual | — | — | "What would you like to change" at document or subtree scope. |

`Task` in `src/provider/types.ts` is the closest thing to a role name that
exists: `planner | patch`. It is deliberately narrow — its own comment records
that a third value was removed because nothing passed it. Roles as described
here would be the general form of that union.

### Two kinds of role, and why the distinction matters

**Generation roles** produce or modify an `H3Document`. Planner and patch. They
are bound to the prompt contract in `reference/h3/contract.json` and their output
passes the zod trust boundary.

**Analysis roles** produce a *field* of a document — a slot description, a
transcript, a caption. Their output is text that later feeds a generation role as
an ordinary supplied fact.

The distinction is not cosmetic. An analysis result can be re-run, overridden by
hand, and stored beside the thing it describes; a generation result is the
document. It also explains why analysis is the natural place for a different
provider: a multimodal backend can do the analysis and hand text to whichever
backend writes the prose, with no coupling between the two.

---

## 7. Binding — conceptual

A binding names, for one role, what to use:

```
role -> provider instance, model, sampler settings, prompt selection,
        schema enforcement, thinking preference
```

Nothing like this exists. Today the provider is a single global choice stored
under the `provider` key and read in `src/ui/useEngine.ts`; both pipeline call
sites use whatever `buildClient` returned from that one selection. The only
per-call variation is Gemini's `plannerThinkingLevel` and `patchThinkingLevel` in
`GeminiConfig` — which is, in miniature, exactly the shape a binding generalises.

Fits today without restructuring, because:

- `ClientParams` and `buildClient` in `src/provider/build.ts` already construct a
  client from a parameter bag. Constructing several, one per role, is the same
  function called more than once.
- `compile` and `edit` both take a client as their first argument. They do not
  reach for a global, so passing a different client per role requires no change
  to either.
- `HeylookClientConfig` already carries per-client preferences such as
  `ThinkingPreference`, which is where per-binding sampler settings would live.

The one thing that would have to change structurally is storage: a single
`provider` setting becomes a row per role. That is the reason this is the first
decision to make rather than a later refinement — the schema either has a place
for it or it becomes a migration.

Two rules carry over from elsewhere in the codebase and should not be relitigated
when this is built:

- The pipeline must never branch on which backend it holds. A binding selects a
  client; it does not tell `compile` which provider it got. See
  [Invariants](invariants.md).
- What produced a document and what the next call will use are different facts.
  `creativeMode` on a document versus the picker's current selection is the
  existing instance of this, and a binding recorded on a document is the same
  pattern: it is provenance, not configuration.

---

## 8. Hierarchy versus one-off

| Thing | Shape | Lives in |
|---|---|---|
| provider type | fixed set, in code | `PROVIDERS` |
| instance | list, one parent provider type | build-time env, via `parseInstances` |
| policy | layered, resolves to one value per attribute | code defaults plus stored overrides |
| role | fixed set, in code | conceptual; `Task` is the current partial form |
| binding | one per role, points at an instance | conceptual; storage |
| model | chosen from a live roster per instance | discovered at runtime for heylook |
| credential | one per instance | conceptual; browser vault today holds only Gemini's |

Model ids are the odd one out and deliberately so: they are install-local for
heylook, discovered by `listModels`, and a hard-coded id would be a 400 on any
machine but the one it was written on. A binding therefore stores a model id as a
*preference* that may fail to resolve, not as a guarantee — the same tolerance
`styleDirective` applies to pack ids it cannot resolve.

---

## 9. What would have to be built, in order

1. Generalise `Instance` to carry a provider type other than heylook, and an
   optional credential reference.
2. Name roles. Widen `Task`, or introduce a role type beside it.
3. Store a binding per role, replacing the single `provider` setting.
4. Bring video analysis behind `InferenceClient` and give its prompt a
   `contract.json` entry, which makes it the first configurable analysis role.
5. Add image/slot analysis as a second analysis role.

Steps 1 through 3 are the structural ones. Steps 4 and 5 are additive once they
exist.

---

## 10. Related reading

- [Provider Layer](provider.md) — the `InferenceClient` seam, both clients, and
  why provider facts carry their provider.
- [Operational Policy](policy.md) — layer resolution and provenance.
- [Invariants](invariants.md) — the rules that constrain any design here.
- [UI & State](ui.md) — where the current global provider selection lives.
