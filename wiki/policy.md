# Operational Policy Subsystem

[Documentation Index](index.md) | [Architecture](architecture.md) | [Provider Layer](provider.md) | [Database & Version Lifecycle](db.md) | [UI & State Management](ui.md) | [Telemetry & Debugging](debug.md)

---

## 1. Overview & Design Philosophy

The operational policy subsystem (`src/core/policy/`) manages the operational characteristics of inference backends—such as concurrency limits, retry timeouts, and expected latency. Unlike traditional systems that classify backends by broad categorical labels (e.g. "cloud" vs "local", or "remote" vs "hosted"), the H3 policy engine isolates individual operational attributes and resolves them through a four-layer inheritance cascade.

### 1.1 The Golden Invariant: Never Branch on Provider Types

A foundational engineering rule in the codebase is:

> **Nothing branches on a provider type.**

There are no statements like `if (type === 'self-operated')` or `if (type === 'local')` anywhere in the codebase. Business logic queries concrete operational attributes (such as `maxConcurrentRequests` or `retryTimeoutMs`). A provider type exists solely as an aggregation point to avoid repeating shared defaults across providers.

**Architectural Rationale:**
Labels like "cloud" and "local" conflate independent dimensions:
- Geographic location vs. operational ownership vs. metering model vs. hardware capacity.
- A local `heylook` server running on an Apple Silicon Mac Studio with 192 GB unified memory serializes generation and can sustain 5-minute thinking runs. The same provider running on a Linux server with an RTX 4090 with 24 GB VRAM might support continuous batching but exhaust memory much faster.
- Concurrency and timeout facts belong to the specific hardware **instance**, not to the provider or category.

---

## 2. Policy Attributes & Field Metadata

The policy schema is declared across `src/core/policy/types.ts` and `src/core/policy/fields.ts`.

### 2.1 Policy Attributes (`Policy`)

```typescript
export interface Policy {
  language?: string;
  maxConcurrentRequests?: number;
  retryTimeoutMs?: number;
  typicalCallMs?: number;
}

export const POLICY_KEYS = [
  'language',
  'maxConcurrentRequests',
  'retryTimeoutMs',
  'typicalCallMs',
] as const satisfies readonly (keyof Policy)[];
```

- `language`: BCP-47 language tag (e.g. `'en'`).
- `maxConcurrentRequests`: Number of concurrent requests permitted against this backend.
- `retryTimeoutMs`: Maximum duration in milliseconds to continue queueing/retrying against an overloaded backend (HTTP 503).
- `typicalCallMs`: Expected execution duration for a single inference call in milliseconds.

### 2.2 Field Metadata & The Settable Honesty Rule

`POLICY_FIELDS` in `src/core/policy/fields.ts` governs validation rules, input rendering, and UI editability:

```typescript
export type PolicyFieldKind = 'text' | 'integer' | 'duration-ms';

export interface PolicyField {
  kind: PolicyFieldKind;
  label: string;
  settable: boolean;
  min?: number;
}
```

The `settable` flag enforces the **Honesty Principle**: only attributes that actively gate runtime behavior in the codebase are exposed as editable in the settings UI.

| Attribute | Kind | Label | Settable | Minimum | Operational Reality |
|---|---|---|---|---|---|
| `language` | `'text'` | Language | `false` | N/A | Resolved to `'en'` by global policy; read by nothing in `src/`. |
| `maxConcurrentRequests` | `'integer'` | Concurrent requests | `false` | 1 | Resolved and displayed, but gates nothing. The UI's single-flight guard (`busy` state) strictly serializes requests regardless of backend capability. |
| `retryTimeoutMs` | `'duration-ms'` | Retry budget | `true` | 0 | **The one attribute with teeth.** Directly mapped by `heylookPolicyConfig` to `HeylookClient.backpressureBudgetMs`, bounding the 503 retry loop. |
| `typicalCallMs` | `'duration-ms'` | Typical call | `false` | 0 | Resolved per provider type for informational display; read by nothing in `src/`. |

---

## 3. The Resolution Cascade (`src/core/policy/resolve.ts`)

Operational attributes are resolved through a 4-layer hierarchy defined in `SCOPES`:

```typescript
export const SCOPES = ['instance', 'provider', 'providerType', 'global'] as const;
export type Scope = (typeof SCOPES)[number];
```

```
                        Resolution Cascade Order
                         (Most specific first)
                                   │
                                   ▼
                   1. instance (Machine Overrides)
              User-configured overrides in IndexedDB
                                   │
                                   ▼
                   2. provider (Specific Provider)
               Constants specific to 'gemini' or 'heylook'
                                   │
                                   ▼
                   3. providerType (Operational Model)
             'metered' (cloud quota) vs 'self-operated' (hardware bound)
                                   │
                                   ▼
                   4. global (System Defaults)
             Universal baseline settings (e.g. language: 'en')
```

### 3.1 Per-Attribute Resolution

Resolution operates per attribute rather than per layer. An instance that overrides only `retryTimeoutMs` still inherits `maxConcurrentRequests` from `providerType` and `language` from `global`.

- `resolveAttribute(layers, key)`: Walks `SCOPES` in order and returns the first layer where `layers[scope]?.[key] !== undefined`. Returns `Sourced<T>` containing `{ value, scope }`.
- `resolvePolicy(layers)`: Resolves all `POLICY_KEYS` into a consolidated `Policy` object.
- `explainPolicy(layers)`: Maps every key to its resolved value and originating `Scope`, allowing the UI to display exactly which layer supplied each value.
- `layersFrom(parts)`: Constructs a clean `PolicyLayers` dictionary, dropping empty scopes.

---

## 4. Default Policies (`src/core/policy/defaults.ts`)

Shipped defaults are minimal and conservative:

### 4.1 Global Policy

```typescript
export const GLOBAL_POLICY: Policy = {
  language: 'en',
};
```
Concurrency is deliberately excluded from `GLOBAL_POLICY` because concurrency is inherently a property of specific machines.

### 4.2 Provider Type Policies

```typescript
export const PROVIDER_TYPE_POLICY: Record<ProviderType, Policy> = {
  metered: {
    maxConcurrentRequests: 4,
    retryTimeoutMs: 30_000,
    typicalCallMs: 15_000,
  },
  'self-operated': {
    maxConcurrentRequests: 1,
    retryTimeoutMs: 5 * 60_000,
    typicalCallMs: 50_000,
  },
};
```

- **`metered` (Cloud APIs):** Concurrency is quota-limited (politeness cap of 4). Retry budget is short (30s) because 429/503 responses reflect rate limits rather than processing lines.
- **`self-operated` (Local Runtimes):** Concurrency defaults to 1 (conservative single-generation assumption). Retry budget is 5 minutes (300,000 ms), reflecting measured generation times on large local models.

---

## 5. Persistence & Machine Overrides (`src/db/policy.ts`)

Users can customize policies for specific local machines (instances). These overrides are persisted in the `settings` store of IndexedDB under key `INSTANCE_POLICY_SETTING = 'instance-policy'`.

### 5.1 Validation Schema

Validators are derived dynamically from `POLICY_FIELDS` rather than hand-coded:
- Text fields require non-empty strings (`z.string().min(1)`).
- Integer and duration fields enforce non-negative values (`.min(0)` or `.min(1)`).
- Unknown keys from future builds are preserved without breaking validation.

### 5.2 Atomic Single-Attribute Writes (`setInstanceAttribute`)

To prevent race conditions where editing one machine or attribute drops another:
```typescript
export async function setInstanceAttribute<K extends keyof Policy>(
  instanceId: string,
  key: K,
  value: Policy[K] | undefined,
): Promise<PolicyWrite> {
  const raw = await getSetting<unknown>(INSTANCE_POLICY_SETTING, null);
  const bag = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};

  // Validate the specific attribute
  if (value !== undefined) {
    const check = validatorFor(key).safeParse(value);
    if (!check.success) {
      return { policies: parseStoredPolicies(bag).policies, rejected: ... };
    }
  }

  // Update or delete entry
  // ...
  await setSetting(INSTANCE_POLICY_SETTING, bag);
  return { policies: parseStoredPolicies(bag).policies };
}
```
- Re-reads raw storage to preserve unrecognized attributes stored by newer builds.
- An empty entry (`{}`) is purged from the bag so an instance does not falsely appear customized.

---

## 6. UI Policy Panel (`src/ui/PolicyPanel.tsx`)

Rendered in the workspace header, `PolicyPanel` surfaces the complete resolution cascade:

### 6.1 Provenance Badges

Each attribute row displays its originating scope using human-readable labels:
- `instance`: "this machine"
- `provider`: "this provider"
- `providerType`: "provider type"
- `global`: "built-in"

### 6.2 Unit Conversion & Draft State

- Milliseconds are stored in IndexedDB, but durations are presented in seconds (`toSeconds`) for readability.
- `PolicyRow` maintains a local `draft` state during editing. Values commit on blur and reset if emptied, allowing users to restore default inherited policies seamlessly.
- Concurrency rows display `describeConcurrency(policy)`, explaining why concurrency is visually displayed but functionally gated by the app's single-flight guard.

---

## 7. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): Overview of subsystem boundaries and compilation pipeline.
- [Provider Layer](provider.md): How `heylookPolicyConfig` maps `retryTimeoutMs` to `backpressureBudgetMs`.
- [Database & Version Lifecycle](db.md): Storage of settings and schema healing in IndexedDB.
- [UI & State Management](ui.md): Integration of `PolicyPanel` within the header bar.
- [Telemetry & Debugging](debug.md): Tracing of policy values and settings updates.
