# Invariants & Hard Engineering Rules

The H3 Transformation Engine is governed by a small set of absolute engineering invariants and operational disciplines. These rules are not conventions or guidelines; they are hard constraints enforced by static AST analysis, automated verification suites, and strict architectural boundaries.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Validation Engine](core_validate.md)

---

## 1. The Two Foundational Invariants

From the repository specification (`CLAUDE.md`):

### Invariant 1: Beats Carry Prose; Enums Are Validated Annotations
> **"The planner writes the actual sentences; the serializer only assembles structure around them (labels, timestamps, tags, section headers, ordering) and never expands an enum into sentences."**

#### Why this invariant exists:
MiniMax H3 video generation models condition on the descriptive literary quality, syntactic continuity, and sensory phrasing of natural language. A canned clause bolted onto a sentence (e.g. mechanically appending `"The camera executes a slow Zoom In."` because `camera.type === 'Zoom In'`) creates the exact *"detached command stack"* that official vendor writing guides explicitly warn against.

#### How it is implemented:
- In the Intermediate Representation (`src/core/ir/types.ts`), `Beat.prose` is the authoritative field that conditions the model.
- Enum fields (such as `Shot.camera`, `Beat.dialogue`, `Shot.cutStyle`, and `Subject.retention`) are strictly **validated annotations**.
- The serializer (`src/core/serialize/`) only injects structural framing: `[Shot N]`, timestamp prefixes `At MM:SS.mmm,`, alignment lines, and section headings. It never synthesizes prose from enums.
- The validator (`src/core/validate/`) checks that the prose and annotations agree (for instance, ensuring that a beat attributing `(S1)` has a matching `speakerId` declared, or that on-screen text in `visibleText` appears verbatim in double quotes in `prose`).

---

### Invariant 2: Prompt Text Is a Pure Function of the Document
> **"The prompt text is a pure function of the document: `serialize(doc, ctx)` is total, pure, and deterministic."**

#### Why this invariant exists:
Allowing human users or models to hand-edit rendered prompt text introduces fatal state desynchronization. In MiniMax prompts, derived scaffolding values (such as alignment lines, shot ordinal headers `[Shot 2]`, cut timestamps `00:03.500`, and reference labels `<Picture 1>`) depend on exact calculations across the entire document. Hand-editing a prompt would immediately decouple the prompt from the underlying media assets, timing grids, and subject definitions.

#### How it is implemented:
- Hand-editing of prompt strings is prohibited across the entire codebase.
- Prompt text is generated strictly via `serialize(doc, ctx)`: given identical `H3Document` and `NormalizedContext`, it produces the exact same string and character-level `SourceSpan[]` map on every invocation.
- If a prompt text element must change (e.g., editing spoken dialogue, adjusting camera motion, or modifying scene prose), the change must be applied to the AST via `applyPatch()` or direct editor mutation (`editDirect()`).
- The UI's live preview re-renders the prompt dynamically on every document edit.

---

## 2. Computational Kernel Purity Guarantees

The core transformation engine (`src/core/`) represents a pure mathematical and syntactic kernel. It must remain fully decoupled from browser environments, UI frameworks, network protocols, and storage engines.

This guarantee is programmatically enforced by `test/purity.test.ts`, which scans all `.ts` files under `src/core/` and fails the test suite if any forbidden pattern is detected.

```
┌────────────────────────────────────────────────────────┐
│               Forbidden Boundaries in src/core/        │
├───────────────────────┬────────────────────────────────┤
│ Target Subsystem      │ Forbidden Import / Pattern     │
├───────────────────────┼────────────────────────────────┤
│ UI Framework          │ from 'react'                   │
│ Provider SDK          │ from '@google/genai'           │
│ Database Engine       │ from 'idb'                     │
│ DOM / Browser Globals │ document., window.,            │
│                       │ localStorage., navigator.      │
│ Network Transport     │ fetch(                         │
│ Telemetry State Sink  │ from '...debug...'             │
└───────────────────────┴────────────────────────────────┘
```

### 2.1 Purity Scanner Implementation (`test/purity.test.ts`)
The purity scanner distinguishes between raw source inspection and executable code inspection:

```typescript
type Scan = 'raw' | 'code';

interface Forbidden {
  pattern: RegExp;
  why: string;
  scan: Scan;
}

const FORBIDDEN: Forbidden[] = [
  { pattern: /from\s+['"]react/, why: 'React', scan: 'raw' },
  { pattern: /from\s+['"]@google\/genai['"]/, why: 'the provider SDK', scan: 'raw' },
  { pattern: /from\s+['"]idb['"]/, why: 'the database layer', scan: 'raw' },
  { pattern: /\b(?:document|window|localStorage|navigator)\s*\./, why: 'the DOM', scan: 'code' },
  { pattern: /\bfetch\s*\(/, why: 'the network', scan: 'code' },
  { pattern: /from\s+['"][^'"]*debug(?:\/[^'"]*)?['"]/, why: 'the debug bus', scan: 'raw' },
];
```

- **`raw` scan mode**: Scans string literals intact (necessary for import path matching).
- **`code` scan mode**: Strips all comments and string literals using `codeOnly(source)` before testing RegExp patterns. This prevents false positives when document prose or error messages legitimately mention words like `"document"` (e.g., `throw new Error('Path does not exist in this document.')`).

### 2.2 Why the Debug Bus Is Forbidden in `src/core/`
The telemetry trace bus (`src/debug/bus.ts`) is an in-memory event sink with a bounded circular buffer (800 events / 4MB). While useful for debugging, a module-level event sink is mutable global state. Permitting `src/core/` to import `trace` would destroy its mathematical purity and prevent it from running in hermetic Node.js batch scripts or ComfyUI worker nodes.

---

## 3. Diagnostic Control Rules & Error Discipline

The validation subsystem (`src/core/validate/`) enforces strict error-handling disciplines designed to eliminate "cry-wolf" warnings and false-green test suites.

### 3.1 Elimination of Warning Severity
- **Errors Only**: The validator recognizes only `error` severity. There is no `warning` severity in the codebase.
- **Provably Malformed Criteria**: A diagnostic is emitted if and only if the document violates a structural, decidable rule (e.g. cut time outside video bounds, undeclared speaker ID, illegal camera type, unclosed `<scenetrans>` pair).
- **Purge of Subjective Prose Checks**: Historical checks that attempted to grade natural language (e.g. checking whether a soundscape had "enough" sentences, or counting descriptive words against an arbitrary quota) were deleted because they fired on legitimate creative variations. Subjective advice belongs in planner prompts, not in structural validators.

### 3.2 100% Red-Proving Control Coverage
Every diagnostic code emitted by `src/core/validate/` must have a corresponding red-proving control fixture in `test/validate.test.ts`:
- An unexercised rule is considered dead code.
- `test/validate.test.ts` includes a meta-test that dynamically scans all rule source files (`rules/timeline.ts`, `rules/speech.ts`, `rules/sections.ts`) using regex to find all emitted diagnostic error codes.
- If any diagnostic code emitted in source code lacks an entry in the `CONTROLS` test array, the build fails immediately.

### 3.3 Cry-Wolf Protection (`Control.inspects`)
To prevent "hollow green" tests, each test control defines an `inspects(doc: H3Document): boolean` guard:
- The green half of a control test asserts that the unmutated base fixture does not trigger the diagnostic.
- If the base fixture does not even contain the syntactic feature the rule inspects (for example, testing dialogue punctuation against a document with zero dialogue lines), the green assertion is vacuous.
- The `inspects` function verifies that the base fixture actually exercises the target code path before testing mutation breakage.

---

## 4. Derived String Invariants & Single Source of Truth

A critical architectural hazard in document compilation is storing derived string representations inside persistent storage.

### 4.1 Never Persist Derived Strings
The following string representations are **strictly derived at point of use** and must **never** be persisted in `H3Document`:
1. **Alignment Lines**: The opening alignment header is dynamically computed from mode, duration, and shot count via `renderAlignmentLine(doc, ctx)`.
2. **Shot Headers**: `[Shot 1]` vs. `[Shot N] At MM:SS.mmm,` is dynamically rendered via `renderShotHeader(shot)`.
3. **Reference Labels**: `<Picture 1>`, `<Video 1>`, `<Audio 1>` are recomputed from slot connection order and roles via `assignLabels(slots)`.
4. **Style Directive Text**: `CreativeModeRecord` stores only pack and anchor IDs (e.g. `V01`, `M04`, `F02`, `A03`). The English prompt clause is derived via `styleDirective(selection)`.
5. **Glitch Mark Directives**: Glitch records store token IDs and surface names; the instructional directive injected into planner prompts is derived via `glitchDirective(glitch)`.

*Engineering Rationale*: If derived strings were persisted in the database, renaming a slot, altering a duration, or reordering a shot would leave stale strings embedded in the document, resulting in silent desynchronization.

### 4.2 Single Canonical String Renderers
When a formatted token is required by both the serializer and the validator, exactly **one** canonical formatting function must exist:
- **`speakerRef(speaker, all)`** (`src/core/serialize/shared.ts`): The single source of truth for vocal source tags. It formats single speakers as `(S1)` and compound speakers as `(S1,S2)` with member ordinals sorted numerically (`sort((a, b) => a - b)`). Prior to centralization, an independent validator implementation sorted ordinals lexicographically, causing 10 speakers to render erroneously as `(S10,S2)`.

---

## 5. Provider Layer Constraints & Disciplines

The provider boundary (`src/provider/`) manages external model execution and adheres to strict operational rules:

1. **Provider Facts Are Provider-Scoped**:
   - Capabilities and quirks are never generalized across backends.
   - **Google Gemini**: Ignores `temperature` parameters; owner ruling dictates sampling temperature must be 1.0 or higher (deterministic mode is prohibited); enforces `store: false`; rejects `thinking_level: 'minimal'` with HTTP 400 (narrowed in TypeScript to `'low' | 'medium' | 'high'`).
   - **heylook (Local Provider)**: Uses Anthropic Messages API format; requires client-side image resizing (max edge 2048px, JPEG 0.85); supports in-flight cancellation via `DELETE /v1/requests/{id}` using `X-Request-ID`.
2. **Per-Call Constrained Decoding (`enforceSchema`)**:
   - Constrained decoding is a per-call parameter (`enforceSchema`, defaulting to `false` via `ENFORCE_SCHEMA_DEFAULT`).
   - When disabled, schemas are injected via shape trailers (`withShapeTrailer`) and responses are extracted using `extractJsonObject`.
3. **Database Lifecycle Disciplines**:
   - When calling `openDB(DB_NAME)`, **never** supply a hardcoded version number.
   - Database schema changes are handled dynamically via `openHealed()` in `src/db/db.ts`, checking for missing object stores or indexes and migrating without wiping user data.
4. **The Empty Search / Negative Grep Trap**:
   - A null search or empty grep result proves nothing unless the search pattern is independently proven capable of matching existing artifacts.
   - When writing tests or asserting absences, always construct a positive control confirming the assertion can fail.

---

## 6. Related Articles

- **[Master Index](index.md)**: Knowledge base table of contents.
- **[Architecture & Pipeline](architecture.md)**: Pipeline stages and data flow.
- **[Intermediate Representation (IR)](core_ir.md)**: Schemas, AST, and patchable leaves.
- **[Validation Engine](core_validate.md)**: Catalog of all 29 rules and 36 diagnostics.
- **[Postmortems & Lessons Learned](postmortems_lessons.md)**: Historical debugging sessions and failure analysis.
