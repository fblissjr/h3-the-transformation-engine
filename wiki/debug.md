# Telemetry, Event Tracing & Debugging Subsystem

[Documentation Index](index.md) | [Architecture](architecture.md) | [Provider Layer](provider.md) | [Database & Version Lifecycle](db.md) | [UI & State Management](ui.md) | [Operational Policy](policy.md)

---

## 1. Overview & Architectural Principles

The transformation engine features an ambient, in-memory telemetry subsystem (`src/debug/`). Designed as a non-invasive observational sink, it traces system behavior across all pipeline phases, inference calls, state changes, and storage transactions without threading logger handles through the computational kernel.

### 1.1 Invariants & Design Philosophy

1. **In-Memory Only:** The event log is never persisted to IndexedDB or `localStorage`. Persisting logs would turn telemetry into an unbounded storage consumer and create privacy residue that the two-phase wipe protocol (`src/db/wipe.ts`) would have to audit and erase. The debug log is scoped to the active browsing session and clears on page reload.
2. **Computational Purity & Total Reliability:** The debug sink has zero external dependencies (no DOM, no network `fetch`, no storage). Emitting a trace event is guaranteed never to throw: if payload redaction or listener dispatch encounters an anomaly, it catches the error internally. Instrumentation must never break the code it observes.
3. **Pre-Buffer Redaction:** All event payloads are scrubbed of credentials, oversized base64 data blobs, and cyclic object graphs on arrival before being committed to memory.

```
                      Telemetry Pipeline (src/debug/)
                                     │
                                     ▼
           emit(record) / trace(channel, event, summary, detail)
                                     │
                                     ▼
                        capSummary(record.summary)
                           (Capped at 300 chars)
                                     │
                                     ▼
                             redact(detail)
                 - Strips API keys & bearer tokens
                 - Elides base64 blobs >= 512 chars
                 - Truncates strings > 24,000 chars
                 - Scoped WeakSet cycle detection
                                     │
                                     ▼
                               weigh(detail)
               Checks against MAX_EVENT_BYTES (500,000 bytes)
                                     │
                                     ▼
                            Event Bus (bus.ts)
                 - MAX_EVENTS = 800 rows
                 - MAX_BYTES = 4,000,000 bytes
                 - Dual oldest-first eviction
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
             UI DebugConsole                 window.__h3debug
        (Channel/level filtering)         (Console & test harness)
```

---

## 2. In-Memory Event Bus (`src/debug/bus.ts`)

The event bus provides structured, memory-capped event buffering across four dedicated channels.

### 2.1 Channels & Event Data Contracts

Channels are defined in `src/debug/types.ts`:
```typescript
export const DEBUG_CHANNELS = ['provider', 'pipeline', 'state', 'storage'] as const;
export type DebugChannel = (typeof DEBUG_CHANNELS)[number];
export type DebugLevel = 'info' | 'warn' | 'error';
```

- `'provider'`: Wire requests, responses, HTTP status codes, thinking levels, backpressure retries, cancellations, and parsing branches.
- `'pipeline'`: Assembly passes, duration snapping, validation passes, and patch operations.
- `'state'`: UI engine commits, head version transitions, and user actions.
- `'storage'`: IndexedDB open/repair events, document saves/loads, version allocations, and wipe protocols.

The event structure (`DebugEvent`) records monotonic sequence numbers, timestamps, channels, event names, summaries, optional durations, and payload details:
```typescript
export interface DebugEvent {
  seq: number;
  at: number;
  channel: DebugChannel;
  event: string;
  summary: string;
  level?: DebugLevel;
  durationMs?: number;
  detail?: unknown;
  bytes: number;
}
```

### 2.2 Memory Bounds & Dual-Constraint Eviction

To ensure that the debug console remains responsive during long sessions without degrading browser performance, `src/debug/bus.ts` enforces three strict limits:
- `MAX_EVENTS = 800`: Upper ceiling on the number of retained log rows.
- `MAX_BYTES = 4_000_000`: Upper ceiling on total retained payload weight (4 MB).
- `MAX_EVENT_BYTES = 500_000`: Upper ceiling on any single event payload (500 KB, computed as `MAX_BYTES / 8`).

#### Eviction Protocol (`evict`)

Eviction operates oldest-first across both row count and byte weight:
```typescript
function evict(): void {
  while (events.length > MAX_EVENTS || bytes > MAX_BYTES) {
    bytes -= events[0].bytes;
    events = events.slice(1);
  }
}
```
Enforcing both limits simultaneously prevents small-event storms from running memory unchecked, while preventing large payloads from dominating the row count.

#### Oversized Payload Degradation

If a single event payload exceeds `MAX_EVENT_BYTES` (500 KB), the bus does not drop the entire buffer. Instead, it replaces the payload with a compact placeholder:
```typescript
const keys = detail != null && typeof detail === 'object'
  ? Object.keys(detail).slice(0, MAX_OVERSIZED_KEYS).map((k) => k.slice(0, MAX_OVERSIZED_KEY_CHARS))
  : [];
const note = `This payload was ${dropped} bytes, over the ${MAX_EVENT_BYTES}-byte per-event cap, and was dropped.`;
detail = { oversized: true, bytes: dropped, keys, note };
```
- `MAX_OVERSIZED_KEYS = 32`: Limits the count of preserved top-level keys.
- `MAX_OVERSIZED_KEY_CHARS = 64`: Truncates key names to prevent adversarial key stuffing.

---

## 3. Pre-Buffer Redaction (`src/debug/redact.ts`)

Redaction executes upon ingestion before an event is added to the buffer. This ensures that:
1. Large image attachments do not occupy the byte budget.
2. The UI "Copy Log" feature cannot inadvertently export secrets or credentials to bug reports.

### 3.1 String and Summary Bounding

- `MAX_STRING = 24_000`: Long enough to preserve an entire system instruction or planner prompt without truncation, while bounding arbitrarily huge text.
- `MAX_SUMMARY = 300`: `capSummary` limits one-line summaries. Because summaries are formatted via string interpolation at call sites, capping them prevents summary bloat from bypassing `MAX_EVENT_BYTES`.

### 3.2 Secret Key Redaction

Field names matching `SECRET_KEY` are replaced with `'[redacted]'`:
```typescript
const SECRET_KEY = /^(?:api[-_]?key|x-api-key|authorization|token|secret|password|passphrase|credential)$/i;
```
*Load-Bearing Note:* Bare `key` is deliberately excluded from `SECRET_KEY`. In the transformation engine, `key` is the property name used by the settings store (`setSetting('provider', ...)` logs `{ key: 'provider' }`). Redacting bare `key` would prevent developers from seeing which setting changed.

### 3.3 Base64 Blob Elision

Field names matching `BLOB_KEY` (`/^(?:data|base64|dataurl|data_url)$/i`) or unbroken strings exceeding `BASE64_MIN = 512` characters matching base64 formatting are elided:
```
[elided: 1048576 characters of encoded data]
```
Because base64 image strings contain no whitespace, natural English prose and prompt text are never mistaken for base64 data.

### 3.4 Path-Scoped Cycle Protection

To prevent recursive loops when inspecting complex objects (such as DOM nodes or React state instances), `redact` maintains a `WeakSet<object>`:
- The object is added to `seen` when traversing into its properties.
- The object is deleted from `seen` in a `finally` block when exiting traversal.
- This path-scoped tracking prevents false `[circular]` markers from appearing when identical sibling objects appear in arrays or parameter lists.

### 3.5 Payload Weight Calculation (`weigh`)

`weigh(detail, summary)` computes serialized JSON length plus summary length. This provides an accurate, portable approximation of the memory footprint.

---

## 4. Provider Instrumentation Decorator (`src/debug/instrument.ts`)

`instrument(client: InferenceClient): InferenceClient` wraps any inference client with automated telemetry:

1. **Request Tracing:** Emits `provider.request` before invoking `client.call()`, recording provider ID, task, token limits, schema flags, image counts, and prompt length via `describeCall()`.
2. **Response Tracing:** Emits `provider.response` on resolution, recording status, duration in milliseconds, character counts, token usage, and top-level parsed keys via `describeResult()`.
3. **Error & Abort Tracing:** Catches exceptions:
   - If the error is an 'AbortError', emits `provider.aborted` at `warn` severity.
   - For all other errors, emits `provider.error` at `error` severity with structured exception details via `describeFailure()`.
4. **Single-Flight Correlation:** Because generation and assisted edits share a single abort controller and are guarded by the UI `busy` state, requests never interleave. Correlation is established by strict time order.

---

## 5. Developer Console Interface (`src/debug/expose.ts`)

For testing, automated evaluation, and head-less inspection, `exposeDebugHandle(window)` binds `window.__h3debug` in browser environments:

```typescript
export interface DebugHandle {
  events: (channel?: DebugChannel) => readonly DebugEvent[];
  last: (n?: number) => readonly DebugEvent[];
  clear: () => void;
  pause: (next?: boolean) => boolean;
  mirror: (next?: boolean) => void;
  bytes: () => number;
}
```

- `window.__h3debug.events('provider')`: Returns all buffered events filtered by channel.
- `window.__h3debug.last(10)`: Returns the most recent 10 events.
- `window.__h3debug.mirror(true)`: Enables immediate console mirroring (`console.debug`, `console.warn`, `console.error`).
- `window.__h3debug.bytes()`: Returns the total current retained byte count (`retainedBytes()`).
- `window.__h3debug.clear()`: Clears the in-memory log buffer (`clearLog()`).

---

## 6. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): Subsystem layout and data flow.
- [Provider Layer](provider.md): Wire request and response tracing for Gemini and heylook.
- [Database & Version Lifecycle](db.md): Storage channel telemetry and wipe residue verification.
- [UI & State Management](ui.md): Integration with `DebugConsole.tsx` and state tracing.
- [Operational Policy](policy.md): Telemetry on policy resolution and machine overrides.
