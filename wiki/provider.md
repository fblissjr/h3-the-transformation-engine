# Provider Layer & Inference Transport Subsystem

[Documentation Index](index.md) | [Architecture](architecture.md) | [Invariants](invariants.md) | [Intermediate Representation](core_ir.md) | [Telemetry & Debugging](debug.md) | [Operational Policy](policy.md)

---

## 1. Overview & Subsystem Boundary

The provider layer (`src/provider/`) forms the transport boundary between the pure compilation kernel (`src/core/`) and external inference engines. In accordance with the purity guarantees verified by `test/purity.test.ts`, the transformation engine's core compilation pipeline (`normalize` -> `plan` -> `validate` -> `patch` -> `serialize`) has zero network dependencies. The provider layer encapsulates all HTTP transport mechanisms, vendor SDKs, prompt trailer formatting, capability checks, and defensive JSON parsing.

The H3 Transformation Engine interfaces with two inference backends:
1. **Google Gemini:** Cloud-hosted, metered model family running over Google's Interactions API (`gemini-3.7-flash`).
2. **heylook:** Self-operated, local model server running MLX and GGUF quantized models over an Anthropic Messages-compatible API (`/v1/messages`).

```
                          InferenceClient Seam
                       (src/provider/types.ts)
                                │
         ┌──────────────────────┴──────────────────────┐
         ▼                                             ▼
   GeminiClient                                  HeylookClient
(src/provider/gemini.ts)                   (src/provider/heylook/client.ts)
   ├── Google GenAI Interactions API             ├── Local Anthropic /v1/messages
   ├── store: false (Hard-wired)                 ├── Wall-clock 503 backpressure
   ├── Thinking: planner=medium, patch=low       ├── Explicit DELETE /v1/requests/{id}
   ├── Omitted temperature                       ├── Capability gating (capabilities[])
   └── Optional constrained decoding             └── Prompt trailer + extractJsonObject
```

---

## 2. The InferenceClient Abstraction

The interface contract defined in `src/provider/types.ts` exposes a minimal asynchronous surface that decouples the engine from vendor-specific semantics.

### 2.1 Interface Definition

```typescript
export interface InferenceClient {
  readonly providerId: ProviderId;
  readonly canEnforceSchema: boolean;
  call<T = unknown>(options: CallOptions): Promise<CallResult<T>>;
}
```

- `providerId`: Union `'gemini' | 'heylook'`.
- `canEnforceSchema`: Boolean capability flag indicating whether the backend natively supports constrained decoding.
- `call<T>(options)`: Dispatches prompt generation and returns structured and unparsed model text.

### 2.2 Core Types

- `Task`: Defined as `'planner' | 'patch'`. This deliberately abstracts away provider-specific thinking levels, allowing each backend client to map the task to its own execution depth.
- `ImageAttachment`: Media inputs travel inline as raw base64 strings without the `data:` URI prefix:
  ```typescript
  export interface ImageAttachment {
    base64: string;
    mimeType: string;
  }
  ```
- `CallOptions`: Carries call-site parameters:
  - `systemInstruction`: String containing base instructions.
  - `prompt`: User prompt content.
  - `task`: `Task` (`'planner' | 'patch'`).
  - `maxOutputTokens`: Optional ceiling on output tokens.
  - `schema`: Optional JSON Schema describing the desired output.
  - `enforceSchema`: Optional boolean controlling whether constrained decoding is requested.
  - `seed`: Optional PRNG seed for deterministic sampling.
  - `images`: Optional array of `ImageAttachment` objects.
  - `model`: Optional string model identifier.
  - `signal`: Standard `AbortSignal` for cancellation.
- `CallResult<T>`:
  - `text`: Complete textual output from the model.
  - `parsed`: Structured payload `T | null` produced either by constrained decoding or defensive JSON extraction.
  - `status`: String terminal status (`completed`, `incomplete`, etc.).
  - `interactionId`: Opaque string identifier assigned by the backend or client.
  - `usage`: Key-value token usage metrics extracted via `extractUsage`.
  - `durationMs`: Wall-clock execution time in milliseconds.

### 2.3 Error Taxonomy

The provider layer specifies three structured error classes:
1. `ProviderError`: Base error carrying `status: string` and optional `interactionId?: string`.
2. `TruncatedError`: Extends `ProviderError`. Thrown when output exceeds `max_output_tokens` (`status: "incomplete"` in Gemini, `stop_reason: "max_tokens"` in heylook). Preserves `partialText: string` and `interactionId` so callers can inspect partial outputs or adjust token budgets.
3. `BackpressureError`: Extends `ProviderError` with status `'503'`. Carries `retryAfterMs: number`. Signals that a local backend is overloaded and unable to service requests within its retry budget.

### 2.4 Helper Utilities

- `dataUrlToAttachment(dataUrl: string)`: Parses `data:image/png;base64,...` URLs into `{ mimeType, base64 }`.
- `extractUsage(container: unknown)`: Normalizes token usage containers from diverse API shapes into a clean dictionary.

---

## 3. Google Gemini Interactions Implementation

`GeminiClient` in `src/provider/gemini.ts` implements `InferenceClient` for Google's Interactions API endpoint (`GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com'`).

### 3.1 Hard Invariant: Zero Retention (`store: false`)

In Gemini Interactions, `store: false` is hard-coded in `buildRequest`:
```typescript
const request: Record<string, unknown> = {
  model: options.model ?? defaultModel,
  input,
  store: false,
  // ...
};
```

**Architectural Rationale:**
- In Google's Interactions API, `interactions.delete` returns HTTP `501 Not Implemented`.
- Any interaction created with `store: true` is permanently retained for the project retention window and cannot be deleted by the client or user.
- Chaining interactions via `previous_interaction_id` requires `store: true`, so conversation chaining is strictly prohibited. Every request is standalone and self-contained.
- Hard-wiring `store: false` guarantees that prompt data never lingers in Google's cloud storage. This invariant is validated by `test/provider.test.ts`.

### 3.2 Thinking Levels and Task Mapping

The Google GenAI SDK defines thinking levels across `minimal | low | medium | high`. However, live probing against `gemini-3.7-flash` established:
- `minimal` returns HTTP `400 Bad Request` (`"'minimal' is not a supported thinking level for this model. Allowed values are: high, low, medium."`).
- The operational floor is `low`.
- Thinking is enabled by default in `gemini-3.7-flash` and thought tokens are billed at the output rate. Leaving `thinking_level` unset bills reasoning at the full rate.

`GeminiClient` maps tasks to explicit thinking levels using the `THINKING` lookup table:
```typescript
export const THINKING: Record<Task, ThinkingLevel> = {
  planner: 'medium',
  patch: 'low',
};
```
Planning benefits from deeper deliberation, whereas surgical patches execute narrow rewrites and operate at the `low` floor.

### 3.3 Deliberate Temperature Omission

`temperature` is intentionally omitted from `generation_config`. Live probing demonstrated that the Gemini Interactions API accepts `temperature` without error but silently ignores it. To prevent misleading users, temperature controls are excluded from both request payloads and the user interface.

### 3.4 Interaction Scoping & Terminal Status Handling

In Google's Interactions API, `system_instruction` and `generation_config` are interaction-scoped. They must be transmitted on every call without exception.

`GeminiClient` inspects terminal execution statuses:
- `completed`: Normal success. Proceed to parsing.
- `incomplete`: Output exceeded token budget. Throws `TruncatedError`.
- `failed`, `cancelled`, `budget_exceeded`: Terminal failures. Throws `ProviderError`.

---

## 4. Heylook Local Provider Subsystem

The `src/provider/heylook/` subsystem provides integration with local LLM runtimes (e.g., MLX on Apple Silicon or GGUF on Linux/Windows) exposing an Anthropic Messages-compatible API (`/v1/messages`).

### 4.1 Architecture & Modules

- `src/provider/heylook/client.ts`: Contains `HeylookClient` implementing `InferenceClient`.
- `src/provider/heylook/config.ts`: Defines `FALLBACK_ORIGIN = 'http://localhost:8000'` and origin normalization routines.
- `src/provider/heylook/discovery.ts`: Asynchronous state machine (`RosterState`, `RosterEvent`, `reduceRoster`) managing model discovery and stale-response rejection.
- `src/provider/heylook/models.ts`: Queries `/v1/models`, gates capabilities (`canServe`), selects sensible defaults (`pickDefaultModel`), and executes pre-flight resident loading (`loadModel`).
- `src/provider/heylook/images.ts`: Client-side image downscaling via HTML5 Canvas (`MAX_EDGE = 2048`, `JPEG_QUALITY = 0.85`).

### 4.2 Non-Streaming Rationale

`HeylookClient` intentionally operates in non-streaming mode. In HTTP SSE streams, response headers flush with HTTP 200 before inference begins; late server refusals (such as context overflow or model contention) are emitted in-band as `error` events, which naive streaming readers often display as generated text. Non-streaming requests fail cleanly as standard HTTP 400/503 status codes.

### 4.3 503 Backpressure vs. Queue Semantics

In heylook, HTTP 503 is not a transient infrastructure failure. It represents an active model overload or memory eviction refusal (`code: "model_overloaded"`):
- Only one MLX model can reside in unified memory at a time.
- Requesting an inference run while another generation is executing causes heylook to return HTTP 503 with header `Retry-After: 1`.
- Live testing on heylook 1.79.53 revealed that `Retry-After: 1` is a static literal rather than an estimate of remaining time.
- `HeylookClient` implements wall-clock bounded exponential backoff:
  ```typescript
  const wait = Math.min(
    Math.max(retryAfterMs(response.headers.get('Retry-After')), MIN_RETRY_MS) * 2 ** attempt,
    MAX_RETRY_MS,
  );
  ```
- Defaults: `BACKPRESSURE_BUDGET_MS = 300_000` (5 minutes), `MIN_RETRY_MS = 1000`, `MAX_RETRY_MS = 15_000`, and `DEFAULT_RETRY_MS = 2000`.
- If the wall-clock deadline is reached, `HeylookClient` throws `BackpressureError`.

### 4.4 Explicit Request Abort Protocol

Standard client-side `fetch` abortion drops the HTTP connection but does not terminate model generation inside local runtimes. To halt execution and release GPU memory, `HeylookClient` tags every outgoing request with a unique `X-Request-ID` (`h3-${Date.now()}-${random}`) and issues an explicit `DELETE` request upon cancellation:
```
DELETE /v1/requests/{requestId}
```
This frees GPU compute resources immediately rather than leaving the server occupied for minutes.

### 4.5 Capability Gating & Model Warmup

In `src/provider/heylook/models.ts`:
- **Capability Gating:** `canServe(model, capability)` checks the model's `capabilities` array (`['chat', 'vision', 'thinking']`), never its `modalities`. MLX runtimes strip audio/vision towers upon loading certain models, making declared modalities unreliable.
- **Warmup Without Generation:** `loadModel(origin, modelId)` issues `POST /v1/models/{modelId}/load` without `?warm=true`. Bypassing `?warm=true` avoids triggering mock token generation that blocks behind the generation lock.
- **Thinking Separation:** `joinTextBlocks(content)` filters content blocks, concatenating only blocks where `type === 'text'`. Reasoning blocks (`type === 'thinking'`) are discarded so thought traces do not pollute JSON extraction.

---

## 5. Schema Enforcement vs. Prompt Trailer Mechanism

The transformation engine balances strict JSON schema conformance against creative prose quality (`src/provider/shape.ts`).

### 5.1 Constrained Decoding Trade-Off

Grammar-based constrained decoding forces a model's output to conform to a context-free grammar or JSON Schema. However, restricting token choices alters the probability distribution during generation, which noticeably degrades descriptive nuance and rhythm. In accordance with Invariant 1 ("Beats carry prose; enums are validated annotations"), prose quality is the paramount objective of the engine.

- `ENFORCE_SCHEMA_DEFAULT = false`: Sessions default to unconstrained generation with defensive parsing.
- Schema enforcement remains a per-call toggle (`CallOptions.enforceSchema`).

### 5.2 Prompt Trailer Formatting

When schema enforcement is disabled (or when calling backends without constrained decoding like heylook), `withShapeTrailer` appends the JSON schema directly to the system prompt:

```markdown
# Output format

Reply with a single JSON object and nothing else. No prose before or after it,
no explanation, no markdown code fences. The object must validate against this
JSON Schema:

{ ... serialized schema ... }
```

Appending the exact schema ensures that prompt instructions do not diverge from runtime Zod schemas.

### 5.3 Defensive JSON Extraction (`extractJsonObject`)

Unconstrained models may wrap JSON in markdown fences, include conversational preambles, or echo back the schema definition. `extractJsonObject` extracts the target object using candidate ranking:

1. **Fence Stripping (`stripFences`):** Outer ```` ```json ```` fences are removed.
2. **Brace Scanning (`balancedObjectAt`):** Scans balanced `{` and `}` delimiters, ignoring braces inside string literals and escaped quotes.
3. **Execution Bounding:** Bounded by `MAX_FAILED_CANDIDATES = 20`. Unbalanced braces in prose are dropped after 20 attempts, eliminating quadratic scanning hazards.
4. **Resemblance Scoring (`resemblance`):** Candidates are scored based on the number of required top-level schema keys present (`requiredKeys(schema)`).

#### Traps Addressed by Resemblance Scoring

| Trap | Failure Mode | Solution in `extractJsonObject` |
|---|---|---|
| **FIRST-MATCH** | Preamble containing an empty brace (e.g. `Here is {}`) is parsed as empty JSON, failing validation. | Evaluates all candidate objects and selects the highest scoring match. |
| **LONGEST-MATCH** | Model echoes the 13,912-character schema definition back. Longest match picks the schema echo rather than the short document. | Schema echo has properties `type`/`properties`/`required` and scores 0 against document keys. |
| **WRAPPER-DEPTH** | Document wrapped inside `{"result": {...}}` has a top-level score of 0, but inner object scores high. | `rank()` assigns rank 2 to top-level candidates with score > 0, rank 1 to nested candidates, and rank 0 to score 0. Scans nested candidates only if top-level score is 0. |

---

## 6. Provider Registry & Build-Time vs. Runtime Boundaries

`src/provider/registry.ts` and `src/provider/build.ts` govern client instantiation and security boundaries.

### 6.1 Content Security Policy (CSP) Invariant

In modern browser environments, network origins must be declared in the Content Security Policy header (`connect-src`).
- **Build-Time Extraction:** `vite.config.ts` imports `src/provider/registry.ts` at build time to extract `allOrigins()` from `VITE_HEYLOOK_INSTANCES` and `VITE_HEYLOOK_ORIGIN`.
- **Runtime Restriction:** Users cannot enter arbitrary HTTP endpoints into the UI at runtime, as undeclared origins violate browser CSP. Only pre-configured instances defined in environment variables are allowed.

### 6.2 Client Construction & Instrumentation

`buildClient(params: ClientParams)` instantiates either `GeminiClient` or `HeylookClient` and wraps it in the `instrument()` decorator from `src/debug/instrument.ts`. The decorator records request parameters, responses, timing metrics, and error traces on the in-memory debug bus.

---

## 7. Prompts & Ground-Truth Discrepancies

Prompt templates are assembled in `src/provider/prompts/`:
- `planner.ts`: Exports `buildPlannerSystemPrompt(ctx, input)` and `buildPlannerUserPrompt(input)`. Ceiled at `PLANNER_MAX_OUTPUT_TOKENS = 16_384`.
- `patch.ts`: Exports `buildPatchSystemPrompt(creativeMode)` and `buildPatchUserPrompt(doc, paths, instruction)`. Ceiled at `PATCH_MAX_OUTPUT_TOKENS = 8_192`.

### Known Ground-Truth Divergence

As cataloged in [Code-Documentation Discrepancies](code_doc_discrepancies.md), the repository contract (`reference/h3/contract.json`) and test suites (`test/contract.test.ts`, `test/creative-integration.test.ts`) assert that `# Recognisable people` must be present in both planner and patch prompts. The codebase implementation removed this section from `src/provider/prompts/planner.ts` and `src/provider/prompts/patch.ts`, causing 6 known test failures in the repository test suite. The code represents ground truth: recognisable people prompt guidance is inactive in the runtime engine.

---

## 8. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): Overview of compiler stages and data flow.
- [Invariants & Hard Engineering Rules](invariants.md): Analysis of the 2 core invariants and purity constraints.
- [Intermediate Representation](core_ir.md): Specification of `H3Document`, AST schema, and patchable leaves.
- [Telemetry & Debugging](debug.md): Detailed mechanics of event tracing, redaction, and `instrument()`.
- [Operational Policy](policy.md): Hierarchical cascade resolution for concurrency and retry timeouts.
