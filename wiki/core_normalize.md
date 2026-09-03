# Deterministic Normalization Subsystem

The **Normalization Subsystem** (`src/core/normalize/`) computes all deterministic values before invoking an LLM. By resolving durations, snapping frame grids, assigning reference labels, inferring compilation modes, and establishing word budgets up front, normalization keeps all arithmetic and exact string derivations out of prompts entirely.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Intermediate Representation](core_ir.md) | [Validation Engine](core_validate.md)

---

## 1. Normalization Pipeline Entry Points (`src/core/normalize/index.ts`)

The subsystem exposes two primary functions:

```typescript
export function normalize(input: CompileInput): NormalizedContext;
export function contextFor(doc: {
  mode: NormalizedContext['mode'];
  durationFrames: number | null;
  durationSeconds: number;
  slots: CompileInput['slots'];
}): NormalizedContext;
```

### 1.1 `normalize(input: CompileInput)`
Executed at the start of compilation:
1. **Duration Resolution (`resolveDuration`)**: Resolves frame count and seconds.
   - If `durationFrames` is supplied, it **wins** over `durationSeconds` because frame count represents the physical rendering unit in the workflow; `durationSeconds` is computed via `framesToSeconds(frames)`.
   - If only `durationSeconds` is supplied, `durationFrames` is set to `null`.
   - Throws `NormalizeError` if neither duration is supplied, or if the supplied duration is non-positive ($\le 0$).
2. **Mode Inference**: Uses `input.mode` if explicitly provided; otherwise infers mode via `inferMode(input.slots).mode`.
3. **Contract Resolution**: Maps mode to `'base'` or `'ref2va'` via `contractFor(mode)`.
4. **Calculated Attributes**:
   - `durationText`: `formatDuration(seconds)` (exactly two decimal places, e.g. `"10.13"`).
   - `onFrameGrid`: `isOnFrameGrid(frames)`.
   - `latestCutMs`: `latestCutMs(seconds)`.
   - `recommendedShots`: `recommendedShots(seconds)`.
   - `spokenWordBudget`: `spokenWordBudget(seconds)`.
   - `labels`: `assignLabels(input.slots)`.

### 1.2 `contextFor(doc)`
Rebuilds the `NormalizedContext` from an existing stored `H3Document` during editing. This ensures that reference labels, budgets, and cut boundaries immediately reflect changes when slots are reordered or durations are modified in the UI editor.

---

## 2. The 24 FPS $17k+5$ Frame Grid & Duration Arithmetic (`src/core/normalize/duration.ts`)

MiniMax H3 video generation models operate natively at 24 frames per second (`FPS = 24`). Frame counts adhere to a discrete arithmetic grid:

$$\text{frames} = 17k + 5 \quad (k \ge 0, k \in \mathbb{Z})$$

Every video sequence begins with an initial 5-frame initialization block followed by integer increments of 17-frame blocks.

```
Frame Progression on 24 FPS Grid:
k=0  ───►  5 frames  (0.21s)
k=1  ───► 22 frames  (0.92s)
k=2  ───► 39 frames  (1.63s)
k=6  ───► 107 frames (4.46s)  <-- Common ~5s target
k=7  ───► 124 frames (5.17s)
k=14 ───► 243 frames (10.13s) <-- Common ~10s target
```

### 2.1 Arithmetic Functions
- **`framesToSeconds(frames: number): number`**: `frames / 24`
- **`secondsToFrames(seconds: number): number`**: `Math.round(seconds * 24)`
- **`formatDuration(seconds: number): string`**: `seconds.toFixed(2)`. The alignment line requires exactly two decimals (e.g. `"10.13"`). The method toFixed is used deliberately because the alignment line is a summary statement about the target video rather than a frame-accurate claim.
- **`formatTimestamp(ms: number): string`**: Formats milliseconds as `MM:SS.mmm` (e.g. `00:03.500`). Short clips retain the leading two-digit minute prefix `00:` in accordance with official worked examples. Throws if `ms` is negative or non-finite.
- **`parseTimestamp(text: string): number | null`**: Parses `MM:SS.mmm` back to milliseconds. Rejects strings where seconds $\ge 60$.

### 2.2 Advisory Grid Functions
- **`isOnFrameGrid(frames: number): boolean`**: `frames >= 5 && (frames - 5) % 17 === 0`.
- **`nearestGridFrames(frames: number): number`**: Computes the nearest legal count on the grid:
  $$\text{nearestGridFrames}(f) = \begin{cases} 5, & f \le 5 \\ \text{round}\left(\frac{f - 5}{17}\right) \times 17 + 5, & f > 5 \end{cases}$$
- **`gridFramesUpTo(maxFrames: number): number[]`**: Generates all valid frame counts up to the ceiling maxFrames for the UI duration dropdown.

*Advisory Nature*: `onFrameGrid` is an **advisory property**, not a validation error. A request that misses the grid still compiles a valid prompt; the rendering engine will snap frames during generation.

---

## 3. Reference Label Assignment (`src/core/normalize/labels.ts`)

Reference labels (`SlotLabel`) are **always derived dynamically** from slot connection order and role assignments. They are never stored on disk and never typed by users or models.

```typescript
export interface SlotLabel {
  slotId: string;
  kind: 'Picture' | 'Video' | 'Audio';
  ordinal: number;
  ref: string;
  standalone: boolean;
}
```

### 3.1 Two Foundational Assignment Rules
1. **Independent Counters per Kind**:
   Picture, Video, and Audio counters increment independently:
   - First image slot $\implies$ `<Picture 1>`
   - Second image slot $\implies$ `<Picture 2>`
   - First video slot $\implies$ `<Video 1>`
   - First audio slot $\implies$ `<Audio 1>`
   The same source video file can legitimately be assigned both `<Video 1>` and `<Audio 2>`. Differing ordinal numbers do not indicate different source files.

2. **Standalone vs. Content Slots**:
   - An image used only to define a character, scene, costume, or style does **not** get a standalone definition line in `subject_definitions` (`standalone: false`); it is cited inside the corresponding `<Subject N>`. However, it still consumes a `<Picture N>` ordinal.
   - An image earns `standalone: true` if and only if it carries a frame anchor role (`first_frame`, `last_frame`, `keyframe`, `storyboard`).
   - A video earns `standalone: true` for `<Video N>` if it carries a video structure role (`edit_source`, `continuation_source`, `structure`).

### 3.2 Dual-Role Video Labeling
If a video slot carries both video structure roles and audio roles (`voice`, `music_style`, `sfx`, `soundtrack_copy`), it earns **two labels**:
1. `<Video N>` (`standalone: true`): Represents the visual and editing structure.
2. `<Audio M>` (`standalone: true`): Represents the synchronized audio track.

*Audio Description Handling*: In Ref2VA prompts, `<Video 1>` and `<Audio 2>` require distinct prose descriptions (e.g. `<Video 1> is the source video for the target video edit.` vs. `<Audio 2> is the synchronized audio track of <Video 1>`). The slot stores `audioDescription` specifically for the audio line, falling back to `description` if absent.

---

## 4. Advisory Mode Inference (`src/core/normalize/mode.ts`)

The `inferMode` function evaluates the attached media slots and suggests the most appropriate H3 compilation mode:

```
                      Attached Reference Slots
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
        Zero Slots                             >= 1 Slot
              │                                     │
              ▼                                     │
            T2VA                                    │
                                 ┌──────────────────┴──────────────────┐
                                 ▼                                     ▼
                          Contains Video/Audio                    Images Only
                                 │                                     │
                                 ▼                                     │
                              Ref2VA                                   │
                                                                       │
           ┌─────────────────────┬─────────────────────┬───────────────┴───────────────┐
           ▼                     ▼                     ▼                               ▼
       No Roles            1 Image: first       2 Images: first+last            1 Image: last
           │                     │                     │                               │
           ▼                     ▼                     ▼                               ▼
    I2VA (unconfident)          I2VA                 FL2VA                            L2VA
```

### 4.1 Mode Inference Matrix
- **0 slots attached**: `T2VA` (confident: true).
- **Any video or audio slots attached**: `Ref2VA` (confident: true). The base contract has no syntax for `<Video N>` or `<Audio N>`.
- **Images only**:
  - **No roles assigned**: `I2VA` (confident: false; prompts user to assign roles).
  - **1 image with `first_frame`**: `I2VA` (confident: true).
  - **2 images with `first_frame` and `last_frame`**: `FL2VA` (confident: true).
  - **1 image with `last_frame`**: `L2VA` (confident: true).
  - **More than 2 images or content roles**: `Ref2VA` (confident: true).

*User Overrides*: Mode inference is an **offer, not a decree**. Because an image alone does not disclose its intended function (the same image could be a starting frame or a character reference), the user can lock the mode via `doc.modeLocked = true`.

---

## 5. Budgets & Pacing Heuristics (`src/core/normalize/budgets.ts`)

Normalization calculates recommended timeline density heuristics to guide LLM planning prompts:

- **`latestCutMs(durationSeconds: number): number`**:
  $$\text{latestCutMs} = \max(0, \lfloor\text{durationSeconds} \times 1000\rfloor - 1)$$
  Calculates the final millisecond where a cut can legally land. A cut at the exact final millisecond leaves zero frames in the final shot.
- **`recommendedShots(durationSeconds: number): number`**:
  - $\le 5\text{s} \implies 1\text{ shot}$
  - $\le 10\text{s} \implies 2\text{ shots}$
  - $\le 15\text{s} \implies 3\text{ shots}$
  - $> 15\text{s} \implies \min(5, \lfloor\text{durationSeconds} / 5\rfloor)$
- **`spokenWordBudget(durationSeconds: number): number`**:
  $$\text{spokenWordBudget} = \lfloor\text{durationSeconds} \times 2.5\rfloor$$
  Calibrated against official guide examples (e.g. an 8-second exchange contains ~18 words) to prevent timeline crowding.
- **`recommendedBeats(durationSeconds: number, dialogueLines = 0): number`**:
  $$\text{recommendedBeats} = \max\left(\max\left(1, \text{round}\left(\frac{\text{durationSeconds} \times 1000}{2500}\right)\right), \text{dialogueLines}\right)$$
  Enforces a density of roughly 1 beat per 2.5 seconds (`MS_PER_BEAT = 2500`), with the parameter dialogueLines acting as an absolute floor because each AST beat holds at most one dialogue utterance.

### 5.1 Documentation of Purged Exports
Lines 79–86 of `src/core/normalize/budgets.ts` record that four dead exports were permanently removed from the codebase:
1. `MIN_SHOT_MS`: Unused minimum shot duration.
2. `'comfortableLatestCutMs'`: The last vestige of the retired "warning" severity ("crossing this is a warning, not an error").
3. `'countWords'`: Redundant text helper.
4. `'countSentences'`: Redundant text helper.

---

## 6. Related Articles

- **[Master Index](index.md)**: Master knowledge base.
- **[Architecture & Pipeline](architecture.md)**: Overall pipeline data flow.
- **[Intermediate Representation](core_ir.md)**: Document models and types.
- **[Validation Engine](core_validate.md)**: Diagnostic checks for timeline bounds and slots.
