# UI & State Management Subsystem

[Documentation Index](index.md) | [Architecture](architecture.md) | [Intermediate Representation](core_ir.md) | [Validation Engine](core_validate.md) | [Serialization](core_serialize.md) | [Provider Layer](provider.md) | [Database & Version Lifecycle](db.md) | [Operational Policy](policy.md)

---

## 1. Overview & Architectural Layout

The user interface (`src/ui/`) is a React single-page application built on a responsive 3-column workspace. Designed as a structured prompt compiler and editor for MiniMax H3 video generation models, the UI maintains strict synchronization between the underlying document AST (`H3Document`), live validation diagnostics, source-mapped serialized prompts, and persistent IndexedDB version trees.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header: ProviderPanel | PolicyPanel | KeyPanel | DebugConsole | DataPanel   │
├───────────────────┬─────────────────────────────┬───────────────────────────┤
│ Left Column       │ Center Column               │ Right Column              │
│ (320px Fixed)     │ (1fr Elastic)               │ (1fr Elastic)             │
├───────────────────┼─────────────────────────────┼───────────────────────────┤
│ - Idea textarea   │ DocumentEditor              │ - Header Bar              │
│ - WildcardPanel   │ - Style field               │   (Char count, tabs)      │
│ - Mode Selector   │ - Reference subjects/summary│ - PromptView              │
│ - Duration Selector│ - Speakers                 │   (Source-mapped prompt)  │
│ - SlotManager     │ - Shots & Beats             │ - Assisted Edit Bar       │
│ - CreativePanel   │   (CutField, Camera, etc.)  │ - Bottom Drawer (max-h-64)│
│ - Generate Button │ - Soundscape & Music        │   - Diagnostics (Problems)│
│                   │                             │   - VersionTree (History) │
└───────────────────┴─────────────────────────────┴───────────────────────────┘
```

---

## 2. The Single-State Engine Hook (`src/ui/useEngine.ts`)

State orchestration is consolidated in the `useEngine` custom hook. Rather than scattering independent state slices across disparate components, `useEngine` acts as the single source of truth for the entire application.

### 2.1 The Inspection Invariant

A central invariant of the engine is that rendered prompt text and validation diagnostics are purely derived properties of the document:
```typescript
const view = useMemo(() => inspect(doc), [doc]);
```
`inspect(doc)` (`src/pipeline.ts`) runs `validate(doc)` across all 29 rules and `serialize(doc)` into the target prompt text. Components never store independent prompt strings or diagnostic lists; any edit to `doc` immediately updates both the serialized prompt view and the diagnostics list.

### 2.2 Core Engine State (`EngineState`)

- `doc`: Current `H3Document | null`.
- `view`: Derived `{ rendered: string; validation: ValidationReport; sourceMap: SourceSpan[] }`.
- `headVersionId`: String identifier of the checked-out version (e.g., `'h3-doc-1:v0003'`).
- `versions`: Complete array of `StoredVersion` objects for the active document.
- `busy`: Union `'Planning' | 'Editing' | null` indicating active background operations.
- `error`: Error banner string displayed in notifications.
- `notice`: Informational notification string.
- `provider`: Active provider (`'gemini' | 'heylook'`).
- `model`: Selected model string.
- `enforceSchema`: Boolean controlling constrained decoding.

### 2.3 Generation & Assisted Edit Workflows

- `generate()`: Reads input idea, selected duration, reference media slots, and creative packs. Normalizes inputs (`normalize()`), constructs planner prompts (`buildPlannerSystemPrompt`, `buildPlannerUserPrompt`), dispatches inference via `InferenceClient.call()`, assembles the AST (`assemble()`), and commits the new document.
- `applyAssisted(instruction, scope)`: Executes an LLM-assisted patch. If `scope === 'direct'`, prompts target selected AST leaf paths; if `scope === 'all'`, wide rewrites are allowed.
- `busy` Guard: Both `generate()` and `applyAssisted()` return early if `busy` is set, guaranteeing that only one generation or assisted edit can run at a time.
- `stop()`: Aborts in-flight inference by calling `abortRef.current?.abort()`.
- `reportOrStopped()`: Inspects caught exceptions. If the error is an `'AbortError'`, it displays a neutral notification (`"Stopped. Nothing was saved..."`) instead of an error banner.

### 2.4 Model Discovery Synchronization

When switching providers or heylook instances, `refreshHeylookModels` polls `/v1/models`. To avoid race conditions from out-of-order network responses, the hook tracks `instanceIdRef.current` and discards replies from superseded instances. If the currently selected model is absent from the newly loaded roster, `pickDefaultModel` automatically selects a fallback model.

---

## 3. Serial Operation Queue (`src/ui/queue.ts`)

Direct user edits (blurring an input field in the document editor) trigger updates to the document and commit new versions to IndexedDB.

### 3.1 The Read-Modify-Write Race

Each direct edit requires reading the current document, applying the edit via `editDirect()`, writing the new document to IndexedDB, and appending a version to the revision tree. 

In rapid editing scenarios (e.g. tabbing through fields or clicking outside an input), two blur events can fire in the same event tick. If both operations read the same initial document state concurrently:
1. The second write overwrites the changes made by the first write in the stored document.
2. Both edits record a version with the same `parentId`, causing an unintended branch in the version tree where one edit disappears from the active branch.

### 3.2 Serial Queue Implementation

`src/ui/queue.ts` implements a promise-chained queue:
```typescript
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
```
A failed task does not stall subsequent tasks in the queue; the tail advances regardless of rejection while the caller still receives its own error.

### 3.3 Dynamic Ref Access in `applyDirect`

Inside `useEngine.ts`, `applyDirect` executes inside the serial queue and reads `docRef.current` at task execution time:

```typescript
const applyDirect = useCallback(
  (path: string, value: unknown): Promise<boolean> =>
    editQueue.current(async () => {
      const current = docRef.current;
      if (!current) return false;
      if (busy) {
        fail(`${busy} is running. The edit to ${path} was not applied.`);
        return false;
      }
      setError(null);
      try {
        const result = editDirect(current, path, value);
        if (result.patch.rejected.length > 0) {
          fail(result.patch.rejected[0].reason);
          return false;
        }
        await commit(result.doc, `Edited ${path}`, result.patch.applied);
        return true;
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    }),
  [busy, commit, fail],
);
```

#### Synchronous Ref Commit

In `commit()`, references are updated synchronously before calling React state setters:
```typescript
docRef.current = next;
headRef.current = version.id;
setDoc(next);
setHeadVersionId(version.id);
```
This guarantees that subsequent tasks queued in the serial queue immediately read the newly committed document state and parent version ID, even if React has not yet completed its render cycle.

---

## 4. Specialized UI Components

### 4.1 Document Editor (`src/ui/DocumentEditor/DocumentEditor.tsx`)

The center column renders a form tree for all editable properties of `H3Document`:
- **Blur Commit Strategy:** Text inputs maintain local drafts during typing and invoke `commit` on blur. This prevents re-rendering on every keystroke.
- **Cut Time Preservation (`cutDraft` / `cutCommit`):** Timestamp inputs use `cutDraft` and `cutCommit`. Missing cut times are left as empty strings rather than auto-zeroed, ensuring that the `SHOT_MISSING_TIMESTAMP` diagnostic is not masked.
- **Sub-Sections:** Provides dedicated editors for style prompts, reference subjects and summary (Ref2VA mode), speaker ordinals, shots, beats, dialogue placeholders, soundscape, and music.

### 4.2 Prompt View & Interactive Highlights (`src/ui/PromptView/PromptView.tsx`)

The right column displays the final serialized prompt text.
- **Source Mapping:** `serialize()` returns `sourceMap: SourceSpan[]` mapping character offset spans `[start, end]` to AST path strings (e.g. `'shots.0.beats.1'`).
- **Interactive Highlighting:** Clicking any character span in `PromptView` highlights the corresponding section and automatically navigates the Document Editor to that AST node.
- **Diagnostic Underlines:** Error and warning diagnostic ranges are overlaid onto the prompt text.

### 4.3 Slot Manager (`src/ui/SlotManager/SlotManager.tsx`)

Manages media attachments for multi-modal inference:
- Reads user-selected media files (images, audio, video).
- Converts images into base64 data URLs for vision model inputs.
- Automatically computes reference ordinals (`<Picture N>`, `<Video N>`, `<Audio N>`) and assigns positional roles (`first_frame`, `last_frame`, `style`, `motion`, `audio`, `identity`).

### 4.4 Diagnostics Panel (`src/ui/Diagnostics/Diagnostics.tsx`)

Rendered in the bottom drawer when the "Problems" tab is active:
- Lists all diagnostics emitted by `validate(doc)`.
- Displays rule IDs, severity badges (Error vs. Warning), and problem descriptions.
- Clicking a diagnostic jumps directly to the invalid form field in the Document Editor.

### 4.5 Version Tree (`src/ui/VersionTree/VersionTree.tsx`)

Rendered in the bottom drawer when the "History" tab is active:
- Visualizes branching version trees constructed by `buildTree()`.
- Renders indentation depth for child branches.
- Allows users to check out any historical version, making it the active document head.

### 4.6 Creative & Wildcard Panels

- `CreativePanel.tsx`: Exposes controls for visual medium packs (V01–V27), motion packs (M01–M08), finish packs (F01–F09), audio packs (A01–A09), style anchors (R01–R30), and glitch mark parameters.
- `WildcardPanel.tsx`: Allows users to insert wildcard tags (e.g. `__LIGHTING__`), roll randomized replacements using a seeded PRNG (`rollSeeded`), and explore the 64-combination experiment matrix.

---

## 5. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): Overview of compiler stages and state flow.
- [Intermediate Representation](core_ir.md): Structure of `H3Document` and patchable leaves.
- [Validation Engine](core_validate.md): Diagnostic rules and error triggers.
- [Serialization Subsystem](core_serialize.md): Alignment line formatting and source mapping.
- [Provider Layer](provider.md): Model invocation and error handling.
- [Database & Version Lifecycle](db.md): Storage schemas, version trees, and data wipes.
- [Operational Policy](policy.md): Management panel for machine concurrency and retry budgets.
