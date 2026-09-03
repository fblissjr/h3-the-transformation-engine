# Prompt Serialization & Guide Fidelity

The **Serialization Subsystem** (`src/core/serialize/`) is responsible for deterministically rendering an `H3Document` AST into a final MiniMax H3 conditioning prompt string. It simultaneously constructs a character-precise source map (`SourceSpan[]`) enabling bidirectional navigation between rendered text and AST nodes.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Invariants](invariants.md) | [Intermediate Representation](core_ir.md)

---

## 1. High-Level Architecture (`src/core/serialize/index.ts`)

Prompt serialization is a **pure and total function**:

```typescript
export interface SerializeResult {
  text: string;
  map: SourceSpan[];
  length: number;
}

export function serialize(doc: H3Document, ctx: NormalizedContext): SerializeResult {
  const { text, map } =
    contractFor(doc.mode) === 'ref2va' ? serializeRef2va(doc, ctx) : serializeBase(doc, ctx);
  return { text, map, length: text.length };
}
```

- **Purity & Determinism**: Given identical `doc` and `ctx`, `serialize` produces the exact same byte string and source map. No random numbers, timestamps, or system clocks are consulted.
- **Contract Dispatch**: Dispatches to `serializeBase` for base modes (`T2VA`, `I2VA`, `FL2VA`, `L2VA`) or `serializeRef2va` for the full-reference mode (`Ref2VA`).

---

## 2. Base Modes vs. Ref2VA Contract

The official MiniMax prompt guides define two fundamentally different formatting contracts:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Base Modes vs Ref2VA Contract                        │
├───────────────────────────────────┬────────────────────────────────────┤
│ Base Contract (T2VA/I2VA/FL2VA/L2VA)│ Full-Reference Contract (Ref2VA)   │
├───────────────────────────────────┼────────────────────────────────────┤
│ 3 Sections:                       │ 6 Sections:                        │
│ - integrated_multimodal_desc      │ - subject_definitions              │
│ - overall_soundscape              │ - summary                          │
│ - non_diegetic_music              │ - retention_analysis               │
│                                   │ - detailed_description             │
│                                   │ - overall_soundscape               │
│                                   │ - non_diegetic_music               │
├───────────────────────────────────┼────────────────────────────────────┤
│ Section headers on same line as   │ Each section header sits on its    │
│ content:                          │ own standalone line:               │
│ integrated_...: [Shot 1] ...      │ subject_definitions:\n...          │
├───────────────────────────────────┼────────────────────────────────────┤
│ Continuous paragraph formatting:  │ Newline-delimited shots:           │
│ shots run together separated by   │ each shot separated by newline     │
│ a single space                    │                                    │
├───────────────────────────────────┼────────────────────────────────────┤
│ Style opens Shot 1 inline:        │ Style stated as standalone         │
│ [Shot 1] <style>, <beat prose>    │ sentence before [Shot 1]           │
└───────────────────────────────────┴────────────────────────────────────┘
```

### 2.1 Base Modes Formatting (`src/core/serialize/base.ts`)
Used for text-to-video (`T2VA`), image-to-video (`I2VA`), first-and-last-frame (`FL2VA`), and last-frame (`L2VA`):
1. **Alignment Line**: If an alignment line exists (`I2VA`, `FL2VA`, `L2VA`), it is emitted followed by two newlines (`\n\n`).
2. **`integrated_multimodal_description: `**: Header sits on the same line as Shot 1. Shots run continuously in a single paragraph.
3. **Inline Style Clause**: In Shot 1, the style medium and finish clause is spliced inline immediately after the header: `[Shot 1] <style>, <prose>`. Trailing punctuation on `style` is stripped via `trimStyleTail` to prevent comma splices like `cinematic., a wide shot`.
4. **`overall_soundscape: `**: Sits on its own line after two newlines, followed by trimmed soundscape text.
5. **`non_diegetic_music: `**: Follows two newlines, rendering the score description.

### 2.2 Ref2VA Mode Formatting (`src/core/serialize/ref2va.ts`)
Used for full-reference video generation (`Ref2VA`):
1. **`subject_definitions:\n`**: Emits `<Subject N> <traits>` for each defined subject, followed by `<Picture N> <description>`, `<Video N> <description>`, or `<Audio N> <audioDescription>` for standalone reference slots.
2. **`summary:\n`**: Emits bracketed task types (e.g. `[video editing + reference generation] `) joined with `" + "`, followed by the summary paragraph.
3. **`retention_analysis:\n`**: For each retention entry, renders:
   `<Target> (<context>): <marker> - <note>`
   *(Audio targets omit parenthetical context in accordance with official examples).*
4. **`detailed_description:\n`**:
   - The `style` clause is emitted as its own standalone complete sentence ending with a period before `[Shot 1]`.
   - Each shot is emitted on its own line separated by `\n`.
5. **`overall_soundscape:\n`** and **`non_diegetic_music:\n`**: Standalone section headers followed by prose.

---

## 3. Alignment Line Formatting & Guide Nuances (`src/core/serialize/shared.ts`)

The alignment line templates (`ALIGNMENT_TEMPLATES` in `src/core/ir/vocab.ts`) reflect subtle syntactic variations across the official guides:

```typescript
export const ALIGNMENT_TEMPLATES: Record<H3Mode, string | null> = {
  T2VA: null,
  I2VA: 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
  FL2VA: 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot {N}) aligns with the {S.SS}-second mark of the target video.',
  L2VA: 'How the reference pictures align with the target video — <Picture 1> (from [Shot {N}]) aligns with the {S.SS}-second mark of the target video.',
  Ref2VA: null,
};
```

### Critical Syntactic Differences:
1. **Bracket Asymmetry between FL2VA and L2VA**:
   - **FL2VA**: Uses bare `Picture 1 (from Shot 1)` and `Picture 2 (from Shot {N})` **without** angle brackets around `Picture` and **without** square brackets around `Shot`! An em dash (`—`, `U+2014`) follows the opening clause.
   - **L2VA**: Uses bracketed `<Picture 1>` and bracketed `[Shot {N}]` with an em dash (`—`, `U+2014`).
   - **I2VA**: Uses bracketed `<Picture 1>` and bracketed `[Shot 1]` with no em dash (`For the target video, at 0.00 seconds...`).
2. **Substitutions**:
   - `{N}`: Evaluated dynamically to `doc.shots.length`.
   - `{S.SS}`: Evaluated dynamically to `ctx.durationText` (formatted to exactly two decimal places).

---

## 4. Shared Serialization Helpers (`src/core/serialize/shared.ts`)

- **`DIALOGUE_PLACEHOLDER = '<d/>'`**: Insertion point for spoken lines. The planner writes complete prose surrounding the placeholder (including speaker introduction, verbs, and off-screen closed-lips clauses).
- **`renderDialogueTag(d: Dialogue)`**: Renders `<d>[${d.language}] ${d.text}</d>`.
- **`spliceDialogue(prose, dialogue)`**: Replaces `<d/>` with the rendered dialogue tag. If dialogue exists but prose lacks `<d/>`, prose is returned unmodified so the validator's `DIALOGUE_PLACEHOLDER_MISSING` diagnostic can report the defect.
- **`speakerRef(speaker: Speaker, all: Speaker[]): string | null`**: Formats vocal source tags. Single speakers render as `(S1)`. Compound speakers render as `(S1,S2)` with member ordinals sorted numerically (`sort((a, b) => a - b)`).
- **`renderShotHeader(shot: Shot): string`**:
  - Shot 1: `"[Shot 1]"`
  - Shot 2+: `"[Shot N] At MM:SS.mmm,"` (rendered via `formatTimestamp(shot.cutAtMs!)`).
- **`trimStyleTail(style: string): string`**: Strips trailing punctuation (`/[.,;]+$/`) to prevent double punctuation when spliced inline into base prompts.

---

## 5. Source Mapping Engine (`src/core/serialize/emitter.ts`)

The `Emitter` class acts as an instrumented string builder that records the character boundaries of every AST node in the output text:

```typescript
export interface SourceSpan {
  path: string; // AST path (e.g. "shots[0].beats[1].prose")
  start: number; // Inclusive start character offset
  end: number; // Exclusive end character offset
}
```

### 5.1 Emitter Methods
- **`write(text)`**: Appends pure scaffolding text (headers, commas, spaces). Creates deliberate "click gaps" not attributed to any AST node.
- **`writeAt(path, text)`**: Appends text and records an attributed `SourceSpan`.
- **`block(path, body)`**: Establishes container spans. For example, `shots[0]` encompasses its header, cut timestamp, and all enclosed beats, while each beat records its own narrower span inside.
- **`build()`**: Returns the final string and sorted spans (outermost first, then ordered by offset).

### 5.2 Span Lookup & Click-to-Fix Utilities
- **`spanAt(map, offset): SourceSpan | undefined`**: Returns the innermost span enclosing a character offset. Returns `undefined` for scaffolding gaps (clicking a blank line or section header selects nothing arbitrary).
- **`spansFor(map, path): SourceSpan[]`**: Returns all spans associated with a path.
- **`rangeOf(map, path): { start: number, end: number } | undefined`**: Returns the outer character boundary for an AST path.

---

## 6. Byte-Exact Fidelity with Official Guides

The serialization engine is verified against official MiniMax H3 writing guides (`reference/h3/`):

### 6.1 Golden Guide Fixtures (`src/core/ir/examples.ts`)
Five canonical documents from official documentation are verified for byte-exact roundtrip serialization in `test/serialize.test.ts` and `test/guide-fidelity.test.ts`:
1. `t2vaBakerExpected`: Base Guide Worked Case 1 (Baker kneading dough).
2. `i2vaTrainExpected`: Base Guide Worked Case 2 (Train passing countryside).
3. `fl2vaUmbrellaExpected`: Base Guide Worked Case 3 (Girl with umbrella in rain).
4. `l2vaGlassExpected`: Base Guide Worked Case 4 (Water poured into glass).
5. `ref2vaCoffeeShopExpected`: Ref Guide Worked Case Section 7 (Coffee shop dialogue).

### 6.2 Strict ASCII Character Discipline
`test/guide-fidelity.test.ts` verifies that every character emitted by the serializer is standard ASCII, with exactly one documented exception:
- The Unicode em dash (`—`, `U+2014`) used in `FL2VA` and `L2VA` alignment line headers.
- Typographic curly quotes (e.g. `’`, `U+2019`) are strictly forbidden; all quotes must be plain ASCII (`'`).

### 6.3 Scoping of Ref 5.2 Word Count Guidelines
Section 5.2 of the Ref Guide mentions a target of 350–500 words for `detailed_description`. `test/guide-fidelity.test.ts` asserts that this recommendation applies strictly to full-generation tasks; video editing tasks and dialogue-dense clips are exempt from word count padding.

---

## 7. Related Articles

- **[Master Index](index.md)**: Master knowledge base.
- **[Architecture & Pipeline](architecture.md)**: Pipeline compilation flow.
- **[Intermediate Representation](core_ir.md)**: AST types and vocabularies.
- **[Validation Engine](core_validate.md)**: Diagnostic checks and rules.
