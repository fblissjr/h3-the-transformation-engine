# Architecture & Compilation Pipeline

The **H3 Transformation Engine** is architected as a pure computational compilation pipeline wrapped by distinct, strictly partitioned runtime layers for transport, persistence, observability, and presentation.

This document describes the compiler's high-level design, pure TypeScript pipeline stages, timing models, data flow, and subsystem boundaries.

[Back to Master Index](index.md)

---

## 1. System Design Philosophy

The engine operates on a strict functional separation between **descriptive planning** (performed by an LLM) and **structural compilation** (performed deterministically by TypeScript):

1. **Prompt-Only Compiler**: The system compiles high-level ideas, durations, and multimodal media assets into structured prompts for the MiniMax H3 video generation models (`T2VA`, `I2VA`, `FL2VA`, `L2VA`, and `Ref2VA`). It executes no video generation itself.
2. **Deterministic Computational Kernel**: All arithmetic (duration calculations, frame grids, word counts, timestamps), structural validation, path resolution, and string serialization occur in pure TypeScript (`src/core/`). No prompt ever asks an LLM to calculate milliseconds, format alignment lines, or manage label counters.
3. **Structured Intermediate Representation**: Rather than editing raw string prompts, all state is maintained inside an Abstract Syntax Tree (AST) called `H3Document`. The prompt text is always a pure, derived projection of this document.

---

## 2. Compilation Pipeline Stages

The compilation pipeline transforms raw user inputs into validated, serializable documents through six discrete stages:

```
[CompileInput]
   │ (idea, duration, slots, creativeMode, roll)
   ▼
[1. normalize()] ──────────────────► [NormalizedContext]
   │ (frames, mode, labels, budgets)           │
   ▼                                           │
[2. plan()] (InferenceClient) ◄────────────────┘
   │ (buildPlannerSystemPrompt, buildPlannerUserPrompt)
   ▼
[PlannerOutput] (Zod parse via PlannerOutputSchema)
   │
   ▼
[3. assemble()] ───────────────────► [H3Document]
   │ (stable IDs, derived retention)           │
   ▼                                           │
[4. validate()] ◄──────────────────────────────┘
   │ (29 pure rules, timeline/speech/sections)
   ▼
[ValidationResult] (diagnostics, ok: boolean)
   │
   ├────────────────────────┐
   │ (optional user edit)   │ (clean pass)
   ▼                        │
[5. applyPatch()]           │
   │ (4-gate surgical edit) │
   ▼                        │
[Updated H3Document]        │
   │                        │
   └───────────┬────────────┘
               ▼
        [6. serialize()]
               │ (base.ts or ref2va.ts via Emitter)
               ▼
        [SerializeResult]
        - text: string (conditioning prompt)
        - map: SourceSpan[] (AST character spans)
        - length: number
```

### Stage 1: Deterministic Normalization (`normalize()`)
- **Module**: `src/core/normalize/index.ts`
- **Input**: `CompileInput` (`idea`, `durationFrames` or `durationSeconds`, `slots`, `creativeMode`, `roll`).
- **Processing**:
  - Resolves duration via `resolveDuration(input)`. If frame count is supplied, it takes precedence over seconds because frame count is the physical rendering unit.
  - Infers compilation mode (`T2VA`, `I2VA`, `FL2VA`, `L2VA`, `Ref2VA`) from attached slots via `inferMode(slots)`.
  - Determines specification contract (`base` vs. `ref2va`).
  - Calculates frame grid adherence on the $17k+5$ grid at 24 FPS via `isOnFrameGrid(frames)`.
  - Determines the latest legal cut time via `latestCutMs(durationSeconds)` ($= \max(0, \lfloor\text{seconds} \times 1000\rfloor - 1)$).
  - Calculates recommended shot count via `recommendedShots(seconds)` and spoken word budgets via `spokenWordBudget(seconds)`.
  - Assigns reference media labels via `assignLabels(slots)` with independent counters for `<Picture N>`, `<Video N>`, and `<Audio N>`.
- **Output**: `NormalizedContext`.
- *Reference*: See [Deterministic Normalization Subsystem](core_normalize.md) for full details.

### Stage 2: Descriptive Planning (`plan()`)
- **Modules**: `src/provider/prompts/planner.ts`, `src/provider/gemini.ts`, `src/provider/heylook/client.ts`
- **Input**: `idea`, `NormalizedContext`, `creativeMode`.
- **Processing**:
  - Synthesizes system instructions via `buildPlannerSystemPrompt(contract, creativeMode)`.
  - Constructs user prompt with pre-computed budgets via `buildPlannerUserPrompt(idea, ctx)`.
  - Invokes the configured `InferenceClient` (Gemini Interactions API or heylook Anthropic Messages API).
  - When constrained decoding is disabled (`enforceSchema: false`), appends `withShapeTrailer(schema)` and defensively extracts JSON using `extractJsonObject(text, expectedKeys)`.
  - Parses raw JSON against `PlannerOutputSchema` (defined in `src/core/ir/schema.ts`). Crucially, `PlannerOutputSchema` omits derived fields (such as shot indices and subject ordinals) to prevent model sequencing hallucinations.
- **Output**: `PlannerOutput`.
- *Reference*: See [Provider Layer](provider.md) and [Intermediate Representation](core_ir.md).

### Stage 3: Document Assembly (`assemble()`)
- **Module**: `src/core/assemble.ts`
- **Input**: `PlannerOutput`, `CompileInput`, `NormalizedContext`.
- **Processing**:
  - Maps 1-based speaker ordinals to deterministic, stable IDs (e.g., `sp-1`, `sp-2`).
  - Maps subject ordinals to deterministic IDs (e.g., `subj-1`, `subj-2`).
  - Maps timeline shots to deterministic IDs (e.g., `shot-1`, `shot-2`) and ensures Shot 1 has `cutAtMs === null`.
  - Identifies user-supplied dialogue lines matching `CompileInput.suppliedDialogue` and flags `userSupplied: true` on the corresponding `Dialogue` objects.
  - Automatically synthesizes Ref2VA `retention` coverage entries for all defined subjects and standalone slots.
  - Stamps immutable metadata (`creativeMode`, `roll`, `schemaVersion: '1.0.0'`).
- **Output**: Canonical `H3Document`.

### Stage 4: Structural Validation (`validate()`)
- **Module**: `src/core/validate/index.ts`
- **Input**: `H3Document`, `NormalizedContext`.
- **Processing**:
  - Executes 29 independent, pure validation rules across three rule suites:
    1. Timeline rules (`rules/timeline.ts` — 9 rules): shot presence, sequential indices, cut timestamps, camera enums, frame anchor roles.
    2. Speech rules (`rules/speech.ts` — 11 rules): speaker ordinals, appearance ordering, dialogue tags, voiceover phrasings, cross-cut scene transitions, terminal punctuation.
    3. Section rules (`rules/sections.ts` — 9 rules): slot ceilings, contiguous ordering, Ref2VA summaries, retention marker classes, label definitions.
  - Operates on an **error-only diagnostic model**: no warning severity exists. Diagnostics indicate provably malformed structure.
  - Each rule runs in an isolated `try/catch` wrapper; if any rule throws an unhandled exception, `validate` catches it and logs a `RULE_THREW` diagnostic rather than crashing the pipeline.
- **Output**: `ValidationResult` (`diagnostics: Diagnostic[]`, `ok: boolean`).
- *Reference*: See [Validation Engine & Diagnostic Catalog](core_validate.md).

### Stage 5: Surgical Patching (`applyPatch()` / `editDirect()`)
- **Modules**: `src/core/patch/apply.ts`, `src/pipeline.ts`
- **Input**: Current `H3Document`, `PatchOutput`, `PatchOrigin` (`'model'` | `'direct'`).
- **Processing**:
  - Processes patch operations through 4 sequential verification gates:
    - **Gate 1 (Allowlist)**: Path must match one of 19 `PATCHABLE_LEAVES`.
    - **Gate 2 (Existence)**: Path must already exist in target document (no auto-vivification).
    - **Gate 3 (User Dialogue Protection)**: If `origin === 'model'`, rejects edits to `shots[].beats[].dialogue.text` where `userSupplied === true`.
    - **Gate 4 (Schema Shape)**: Value is coerced via `coerceToLeaf` and validated against `H3DocumentSchema` leaf definition.
  - Immutably updates the document using `setAtPath` with structural sharing.
- **Output**: `PatchResult` (`doc: H3Document`, `applied: AppliedOperation[]`, `rejected: RejectedOperation[]`).
- *Reference*: See [Patch Subsystem & Surgical Modification](core_patch.md).

### Stage 6: Deterministic Serialization (`serialize()`)
- **Modules**: `src/core/serialize/index.ts`, `base.ts`, `ref2va.ts`, `emitter.ts`
- **Input**: `H3Document`, `NormalizedContext`.
- **Processing**:
  - Dispatches to `serializeBase` for base modes (`T2VA`, `I2VA`, `FL2VA`, `L2VA`) or `serializeRef2va` for `Ref2VA`.
  - Computes and renders mode-specific alignment lines (`renderAlignmentLine`).
  - Slices dialogue tags into beat prose (`spliceDialogue`) at `<d/>` placeholders.
  - Uses `Emitter` to construct the prompt string while simultaneously tracking character-level bounding intervals (`SourceSpan = { path, start, end }`).
- **Output**: `SerializeResult` (`text: string`, `map: SourceSpan[]`, `length: number`).
- *Reference*: See [Serialization Engine & Reference Guide Fidelity](core_serialize.md).

---

## 3. Timing & Pacing Models

The engine enforces precise timing relationships calibrated against MiniMax H3 vendor documentation and physical 24 FPS video constraints:

### 3.1 The 24 FPS Native Grid ($17k + 5$)
MiniMax H3 operates at a native frame rate of 24 frames per second (`FPS = 24`). Frame counts must adhere to the discrete formula:

$$\text{frames} = 17k + 5 \quad (k \ge 0)$$

- Every clip contains an initial 5-frame block followed by integer multiples of 17 frames.
- Standard valid frame counts:
  - $k=0 \implies 5 \text{ frames} \approx 0.21\text{s}$
  - $k=6 \implies 107 \text{ frames} \approx 4.46\text{s}$
  - $k=7 \implies 124 \text{ frames} \approx 5.17\text{s}$
  - $k=14 \implies 243 \text{ frames} \approx 10.13\text{s}$
- Frame grid functions in `src/core/normalize/duration.ts`:
  - `isOnFrameGrid(frames)`: verifies if `(frames - 5) % 17 === 0`.
  - `nearestGridFrames(frames)`: snaps an arbitrary frame count to the nearest legal point.
  - `gridFramesUpTo(maxFrames)`: generates valid frame choices for the UI duration picker.

### 3.2 Cut Timestamps
Timeline cut times (`cutAtMs`) represent the boundary transitions between consecutive shots:
- **Shot 1**: Strictly carries `cutAtMs = null` (Shot 1 begins at the start of the video; assigning a timestamp triggers `SHOT_1_HAS_TIMESTAMP`).
- **Shot 2+**: Must carry positive, strictly increasing millisecond integers formatted as `MM:SS.mmm` (e.g. `00:03.500`).
- **Upper Bound**: Cuts must occur strictly before the end of the video:
  $$\text{cutAtMs} \le \text{latestCutMs}(\text{durationSeconds}) = \max(0, \lfloor\text{durationSeconds} \times 1000\rfloor - 1)$$
  A cut at or past the final millisecond is rejected with `CUT_OUTSIDE_DURATION` because it would create a zero-length shot.

### 3.3 Word and Beat Pacing Heuristics
- **Beat Density**: `MS_PER_BEAT = 2500` (approximately 1 dominant beat per 2.5 seconds of timeline).
- **Spoken Word Rate**: `WORDS_PER_SECOND = 2.5` (calibrated against worked guide examples to prevent timelines from crowding dialogue).
- **Recommended Beats**:
  $$\text{recommendedBeats}(s, \text{dialogueLines}) = \max\left(\max\left(1, \text{round}\left(\frac{s \times 1000}{2500}\right)\right), \text{dialogueLines}\right)$$
  Because each beat in the AST can hold at most one dialogue object, supplied dialogue lines act as a hard floor on beat count.

---

## 4. Subsystem Boundaries & Architecture Matrix

To maintain total testability and isolation, the repository enforces strict architectural boundaries:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           UI Layer (src/ui/)                            │
│  React Components, useEngine Hook, OperationQueue, Live Prompt Preview   │
└────────┬──────────────────────┬──────────────────────┬───────────────────┘
         │                      │                      │
         ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐
│ Transport Layer  │  │ Persistence Layer│  │ Telemetry Layer              │
│ (src/provider/)  │  │ (src/crypto/, db)│  │ (src/debug/)                 │
│ Gemini & heylook │  │ AES-GCM Vault,   │  │ Bounded circular event bus,  │
│ InferenceClients │  │ IndexedDB stores │  │ PII & secret redaction       │
└────────┬─────────┘  └─────────┬────────┘  └──────────────┬───────────────┘
         │                      │                          │
         └──────────────────────┼──────────────────────────┘
                                │ (Pure Data Only)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                   Pure Computational Kernel (src/core/)                  │
│                                                                          │
│  ├── ir/          Document AST, Zod Schemas, Paths, Closed Vocabularies   │
│  ├── normalize/   Duration Math, Label Counters, Mode Inference, Budgets │
│  ├── assemble/    Entity ID Mapping, Derived Retention Synthesis         │
│  ├── validate/    29 Pure Structural Rules, 36 Diagnostic Codes          │
│  ├── serialize/   Base & Ref2VA Formatters, Emitter Source Maps          │
│  ├── patch/       4-Gate Verification, setAtPath Structural Sharing      │
│  ├── creative/    Visual Packs, Anchors, Strength Axes, Glitch Marks     │
│  ├── wildcards/   Seeded PRNG (mulberry32), Experiment Matrices          │
│  └── policy/      Hierarchical Policy Cascade, Concurrency Budgets       │
└──────────────────────────────────────────────────────────────────────────┘
```

### Boundary Enforcement
- **`src/core/` (Pure TypeScript Kernel)**:
  - Absolutely zero imports from `react`, `@google/genai`, `idb`, or `src/debug/`.
  - Zero access to DOM globals (`window`, `document`, `localStorage`, `navigator`) or network globals (`fetch`).
  - Runs in any execution environment: browser, Node.js scripts, Vitest test runner, or ComfyUI integration nodes.
  - Programmatically enforced by `test/purity.test.ts`.
- **`src/provider/` (Transport Boundary)**:
  - Implements the `InferenceClient` interface.
  - Manages wire protocols (Gemini Interactions API vs. heylook Anthropic Messages API).
  - Handles network errors, retry budgets, exponential backoff, and model cancellation.
- **`src/crypto/` & `src/db/` (Persistence Boundary)**:
  - Manages browser `IndexedDB` lifecycle with versionless schema repair (`openHealed`).
  - Encrypts API keys at rest using WebCrypto AES-GCM-256 and PBKDF2 in the `"H3KeyVault"` store.
- **`src/debug/` (Observability Sink)**:
  - Module-level in-memory ring buffer (800 events / 4MB limit) across 4 channels (`provider`, `pipeline`, `state`, `storage`).
  - Never writes to persistent disk or IndexedDB; automatically redacts secrets and truncates large payloads.
- **`src/ui/` (Presentation Layer)**:
  - Driven by the `useEngine` custom React hook.
  - Serializes asynchronous operations through `createSerialQueue` to guarantee single-flight execution and prevent race conditions.

---

## 5. Related Articles & Next Steps

- **[Invariants & Hard Engineering Rules](invariants.md)**: Explore the two foundational invariants and purity testing rules.
- **[Intermediate Representation (IR)](core_ir.md)**: Inspect the complete AST, Zod schemas, and path addressing syntax.
- **[Deterministic Normalization](core_normalize.md)**: Study the $17k+5$ grid arithmetic, mode inference, and label counting logic.
- **[Validation Engine](core_validate.md)**: Complete catalog of all 29 rules and 36 diagnostic codes.
- **[Prompt Serialization](core_serialize.md)**: Deep dive into base modes, Ref2VA, alignment lines, and source mapping.
- **[Patch Subsystem](core_patch.md)**: Understand surgical editing, 4-gate verification, and dialogue protection.
