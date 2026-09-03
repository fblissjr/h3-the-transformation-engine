# Wildcards & Experiment Matrix Subsystem

[Back to Master Index](index.md) · [Creative Engine](core_creative.md) · [Glitch Marks Subsystem](glitch_marks.md) · [Architecture Guide](architecture.md) · [Intermediate Representation](core_ir.md)

---

## 1. Architectural Purpose & Decoupling Principle

The Wildcards subsystem (`src/core/wildcards/`) enables rapid content variation across H3 prompts through dynamic placeholder substitution and systematic combinatorial matrix testing.

### Content vs. Style Separation

The fundamental design principle governing wildcards is the strict decoupling of **content** from **style**:
- **Style packs (`src/core/creative/packs.ts`):** Decide *how* a clip looks (medium, lighting, camera physics, rendering, finish, sound texture).
- **Wildcards (`src/core/wildcards/library.ts`):** Decide *what* is in the scene (who the subject is, what physical action occurs, where it happens, props, weather, complications).

Maintaining this separation is what allows human operators and automated evaluation harnesses to hold style constant while varying content—or hold content constant while varying style. This is the prerequisite for conducting scientifically valid A/B prompt evaluations on generative video backends.

### Pipeline Placement

Wildcard substitution operates exclusively on the raw idea string before compilation:
$$\text{idea with wildcards} \xrightarrow{\text{roll / experimentMatrix}} \text{resolved idea} \xrightarrow{\text{compile()}} \text{H3Document}$$

Nothing downstream of `CompileInput` ever sees a placeholder. Prompt serialization (`serialize(doc, ctx)`) is a pure function of the document; if an unexpanded placeholder like `{setting}` were allowed into `assemble()`, it would be serialized directly into the generated prompt. To prevent this, `compile()` in `src/pipeline.ts` explicitly enforces an early-stage gate rejecting any input with unexpanded placeholders before spending an inference call.

---

## 2. Wildcard Library (`WILDCARDS`: 12 Categories, 122 Values)

The canonical library in `src/core/wildcards/library.ts` defines 12 categories containing exactly **122 curated values**:

```ts
export interface WildcardCategory {
  readonly id: string;
  readonly description: string;
  readonly values: readonly string[];
}
```

### The Two Authoring Constraints

Every value in the library adheres to two non-negotiable rules inherited from the H3 prompt architecture:
1. **Concrete and Observable:** Values must name physical, recordable objects, actions, and environments. Emotional abstractions and mood adjectives (e.g., "melancholy", "mysterious", "joyful") are strictly forbidden. The test suite (`test/wildcards.test.ts`) programmatically audits every value against an abstract mood word blocklist.
2. **Fragments, Not Sentences:** Values are designed for mid-sentence splicing into user-authored prompts. They carry **no leading capital letters** and **no terminal punctuation**.

### Complete Category Catalog

| # | Category ID (`WildcardCategoryId`) | Description | Count | Examples |
|---|---|---|---|---|
| 1 | `subject` | Who or what the clip is about | 14 | `'a night-shift baker'`, `'a lighthouse keeper'`, `'two sisters sharing one umbrella'`, `'a violin maker sanding a scroll'` |
| 2 | `action` | What physically happens | 14 | `'unlocks a door that has swollen in the damp'`, `'lights a burner that catches on the third try'`, `'counts coins onto a countertop'` |
| 3 | `setting` | Where it happens | 14 | `'a municipal swimming pool after closing'`, `'a laundrette at four in the morning'`, `'a greenhouse with taped-up panes'` |
| 4 | `time` | When | 8 | `'twenty minutes before sunrise'`, `'the blue hour after sunset'`, `'just after a power cut ends'` |
| 5 | `weather` | Air and sky | 8 | `'fine rain that never quite stops'`, `'fog thick enough to soften the far wall'`, `'wet snow that melts on contact'` |
| 6 | `prop` | One object that matters | 12 | `'a thermos with a dented lid'`, `'a single unmatched glove'`, `'a folding chair with a broken hinge'` |
| 7 | `complication` | The thing that goes sideways | 12 | `'the object turns out to be heavier than expected'`, `'something breaks quietly and nobody notices yet'`, `'a door closes on its own'` |
| 8 | `sound` | One audible event | 10 | `'a fluorescent tube ticking as it warms up'`, `'water moving in a pipe behind the wall'`, `'gulls arguing on a roof'` |
| 9 | `material` | A surface or texture in frame | 10 | `'chipped enamel'`, `'wet galvanised steel'`, `'cracked vinyl upholstery'`, `'worn terrazzo'` |
| 10 | `creature` | Something alive that is not the subject | 8 | `'a heron standing in shallow water'`, `'moths circling a work light'`, `'koi under a dark surface'` |
| 11 | `era` | When the world of the clip is set | 6 | `'the present day'`, `'the late 1970s'`, `'the mid 1990s'`, `'the 1930s'`, `'a near future with visibly older infrastructure'`, `'the early 2000s'` |
| 12 | `scale` | How big the moment is | 6 | `'one small task, start to finish'`, `'the tail end of something much larger'`, `'a handover between two people'`, `'the moment before a decision'` |

Total: $14 + 14 + 14 + 8 + 8 + 12 + 12 + 10 + 10 + 8 + 6 + 6 = \mathbf{122\text{ values}}$.

---

## 3. Substitution Syntax & Expansion Mechanics

Expansion is implemented in `src/core/wildcards/expand.ts`:

### Syntax Modifiers

Placeholders are matched using the regular expression:
```ts
/\{([a-z][a-z0-9_]*)(?::(all|random|\d+random))?\}/gi
```

Four syntax variants are supported:
- `{category}`: Draws **1 random value** from the category.
- `{category:random}`: Explicit equivalent of `{category}` (draws 1 random value).
- `{category:Nrandom}` (e.g., `{prop:3random}`): Draws **$N$ distinct values** from the category, joined with commas (`", "`). If $N$ exceeds the category length, all values are drawn without repetition.
- `{category:all}`: Draws **all values** in the category in their original defined library order, comma-joined.

### Expansion Invariants

1. **Right-to-Left Replacement:** `roll()` replaces matches in descending order of string offset (`sort((a, b) => b.at - a.at)`). This prevents earlier substitutions from shifting the character indices of subsequent placeholders.
2. **Category-Draw Reuse:** Multiple occurrences of the same category request within a single template reuse the exact same drawn value:
   - Example: `"{setting} then back to {setting}"` resolves to `"a laundrette at four in the morning then back to a laundrette at four in the morning"`.
   - `{setting}` and `{setting:random}` share the same draw cache key (`category\0count`). Different counts (e.g., `{prop}` and `{prop:2random}`) are treated as separate draws.
3. **Graceful Handling of Unknown Categories:** Any placeholder referencing an unknown category (e.g., `{custom_item}`) is left completely intact in the prompt text and recorded in the `unknown` array of `RollResult`. Silent deletion is avoided.

---

## 4. Seeded PRNG & Reproducibility (`mulberry32`)

To ensure that random rolls are fully reproducible, `src/core/wildcards/expand.ts` implements the **mulberry32** pseudo-random number generator:

```ts
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- **Repeatability:** `rollSeeded(text, seed)` executes `roll` using the deterministic `seededRandom(seed)` function.
- **Seed Allocation:** `newSeed()` produces numbers in the range $[0, 1\,000\,000)$ suitable for human entry in the UI.
- **Roll Stamping:** `rollRecord(template, seed)` returns a `{ template, seed }` pair (`WildcardRoll`) stored on `H3Document.roll` only when at least one placeholder was successfully substituted.

---

## 5. Experiment Matrix Subsystem (`src/core/wildcards/matrix.ts`)

While rolling produces a single randomized prompt, `experimentMatrix` generates a systematic Cartesian product of nominated values to enable rigorous comparative evaluations.

```ts
export interface Matrix {
  cells: MatrixCell[];
  axes: { category: string; values: string[] }[];
  fixed: { category: string; values: string[] }[];
  total: number;
  truncated: boolean;
}
```

### Operational Rules

1. **Cartesian Product:** For each category acting as an axis, `experimentMatrix` computes every combination of nominated values in odometer order.
2. **Matrix Ceiling (`MATRIX_CELL_LIMIT = 64`):** A combinatorial explosion can easily create thousands of permutations (e.g., 4 axes of 3 values each produces 81 cells). To prevent unmanageable test runs and accidental provider billing, the output is strictly capped at **64 combinations** (`MATRIX_CELL_LIMIT`). If the total exceeds 64, `truncated` is set to `true`.
3. **Multi-Draw Placeholders Held Fixed:** Any placeholder requesting multiple values (`{prop:3random}`, `{era:all}`) is **not** treated as an axis. Instead, it is drawn once using `seededRandom(seed)` and held completely constant across every single matrix cell.
4. **Configuration Fallback:** If the user specifies an axis configuration naming only non-existent values for a category, `experimentMatrix` falls back to using all valid values for that category rather than dropping the axis and leaking unexpanded placeholders.

---

## 6. Prototype Pollution Defense (`Object.create(null)`)

During early integration testing (Session 2026-08-28), a critical prototype pollution vulnerability was discovered and resolved in `src/core/wildcards/matrix.ts`.

### The Vulnerability

When a template contained `{constructor}`, the parser recognized that `constructor` was not in `WILDCARDS` and skipped it as an axis, leaving `{constructor}` in the text. However, during cell substitution:
```ts
values['constructor'] // Looked up on standard JavaScript Object
```
Because standard JavaScript objects inherit from `Object.prototype`, this lookup resolved to `Object.prototype.constructor`. The substitution step then stringified the JavaScript native function into the prompt:
`"function Object() { [native code] }"`

Because the stringified function contained no `{` or `}` braces, it bypassed the compile guard, and an expensive model call was spent on corrupted text.

### The Defensive Fix

In `product()` (`src/core/wildcards/matrix.ts`), all row accumulator objects are instantiated with **null prototypes**:
```ts
let rows: Record<string, string>[] = [Object.create(null)];
for (const axis of axes) {
  const next: Record<string, string>[] = [];
  for (const row of rows) {
    for (const value of axis.values) {
      if (next.length >= limit) break;
      next.push(Object.assign(Object.create(null), row, { [axis.category]: value }));
    }
  }
  rows = next;
}
```
Furthermore, `substitute()` checks `Object.prototype.hasOwnProperty.call(values, p.category)` before accessing values. This completely prevents any inherited properties from `Object.prototype` (`"constructor"`, `"toString"`, `"valueOf"`, `"hasOwnProperty"`) from being interpreted as substitution values. Verified by `test/wildcards.test.ts`.

---

## 7. Verification & Test Coverage

The subsystem is validated in `test/wildcards.test.ts`:
- **Parsing & Bounds:** Verifies `placeholdersIn` and `hasPlaceholders` across empty braces, arbitrary prose in braces, and case-insensitivity.
- **Roll Totality & Seeding:** Tests deterministic re-rolls with `mulberry32` seeds, deduplication of repeated placeholders, and distinctness guarantees for `:Nrandom`.
- **Compile Guard:** Proves that `compile()` rejects unexpanded placeholders before invoking the inference client (`PlanError`).
- **Matrix Permutations:** Tests Cartesian products, `MATRIX_CELL_LIMIT` truncation, and multi-draw constancy.
- **Prototype Pollution Suite:** Tests that `{constructor}`, `{toString}`, `{valueOf}`, and `{hasOwnProperty}` are left untouched in output text and rejected by the compile guard.
