# Intermediate Representation (IR) & Schemas

The Intermediate Representation (IR) defines the canonical data models, validation schemas, path addressing syntax, and closed vocabularies that form the foundation of the H3 Transformation Engine.

All modules in `src/core/ir/` are pure TypeScript with zero external or runtime dependencies outside of `zod`.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Patch Subsystem](core_patch.md) | [Validation Engine](core_validate.md)

---

## 1. Canonical Document AST (`src/core/ir/types.ts`)

The root data structure of the engine is `H3Document`. It represents a fully resolved, structured transformation plan ready for serialization or surgical modification.

### 1.1 `H3Document`
```typescript
export interface H3Document {
  schemaVersion: '1.0.0';
  id: string;
  mode: H3Mode;
  modeLocked: boolean;
  durationFrames: number | null;
  durationSeconds: number;
  style: string;
  slots: ReferenceSlot[];
  subjects: Subject[];
  speakers: Speaker[];
  shots: Shot[];
  soundscape: string;
  music: string;
  // Ref2VA specific fields
  summary?: string;
  taskTypes?: TaskType[];
  retention?: RetentionEntry[];
  // Metadata fields
  creativeMode?: CreativeModeRecord;
  roll?: WildcardRoll;
}
```

- **`schemaVersion`**: Fixed at `'1.0.0'`.
- **`mode`**: One of `'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA'`.
- **`modeLocked`**: Boolean flag indicating whether the user explicitly pinned the mode or allowed auto-inference from slots.
- **`durationFrames`**: Physical frame count on the 24 FPS $17k+5$ grid (or `null` if seconds were supplied).
- **`durationSeconds`**: Effective duration in seconds, rendered to exactly two decimal places in alignment lines (`ctx.durationText`).
- **`style`**: Media style, lens, lighting, and finish clause. In base modes, it opens `[Shot 1]` inline (`[Shot 1] <style>, <prose>`). In Ref2VA, it is emitted as its own standalone sentence before `[Shot 1]`.
- **`soundscape`**: Overall environmental audio and Foley description (1–4 sentences, or `"N/A"`).
- **`music`**: Non-diegetic score description (1–3 sentences, instrumentation/tempo, no mood adjectives, or `"N/A"`).

---

### 1.2 Timeline Nodes: `Shot`, `Beat`, and `Dialogue`

```typescript
export interface Shot {
  id: string;
  index: number;
  cutAtMs: number | null;
  cutStyle?: CutStyle;
  camera: CameraAnnotation | null;
  beats: Beat[];
}

export interface Beat {
  id: string;
  prose: string;
  speakerId?: string;
  dialogue?: Dialogue;
  visibleText: string[];
  citesSlots: string[];
  citesSubjects: string[];
}

export interface Dialogue {
  language: string;
  text: string;
  voiceover: boolean;
  crossesCut?: 'starts' | 'continues';
  cutoff?: boolean;
  fragment?: boolean;
  userSupplied: boolean;
}
```

- **`Shot.index`**: 1-based sequential integer driving `[Shot N]` scaffolding.
- **`Shot.cutAtMs`**: Millisecond timestamp for the transition boundary. Strictly `null` for Shot 1; strictly positive and increasing for Shot 2+.
- **`Shot.camera`**: Annotation (`type: CameraType`, optional `amplitude`, optional `speed`). Medium amplitude and normal speed are represented by omitting the fields.
- **`Beat.prose`**: Authoritative text that conditions the model. Contains the `<d/>` placeholder if dialogue is present.
- **`Dialogue.userSupplied`**: Protects user-typed lines from being modified by model-originated patches (`applyPatch`).
- **`Dialogue.fragment`**: Flags intentional sentence fragments (chants, lyrics, interjections) exempting them from terminal punctuation requirements.

---

### 1.3 Media & Content Nodes: `ReferenceSlot`, `Subject`, `Speaker`

```typescript
export interface ReferenceSlot {
  id: string;
  order: number;
  kind: MediaKind; // 'image' | 'video' | 'audio'
  roles: SlotRole[];
  filename?: string;
  mimeType?: string;
  dataUrl?: string;
  description: string;
  audioDescription?: string;
}

export interface Subject {
  id: string;
  ordinal: number;
  sources: SubjectSource[];
  traits: string;
  appearsInShots: string[];
  retention: VisualRetention;
  retentionNote: string;
}

export interface Speaker {
  id: string;
  ordinal: number;
  descriptor: string;
  subjectId?: string;
  compoundOf?: string[];
}
```

- **`ReferenceSlot`**: Media asset attached to the compilation. `order` is 0-based and contiguous. When a video slot carries both video structure roles and audio roles, it earns two labels (`<Video N>` and `<Audio M>`) and uses `audioDescription` for the audio line.
- **`Subject`**: Reusable visible entity in Ref2VA (`<Subject N>`). Reusable across multiple slots and shots.
- **`Speaker`**: Vocal source driving `(S1)`, `(S2)`. `descriptor` is the physical voice introduction. `compoundOf` lists member IDs for chorus vocalizations (`(S1,S2)`).

---

## 2. Asymmetric Zod Schemas (`src/core/ir/schema.ts`)

The engine maintains two distinct, intentionally asymmetric schema hierarchies:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Asymmetric Schema Architecture                       │
├───────────────────────────────────┬─────────────────────────────────────┤
│ H3DocumentSchema                  │ PlannerOutputSchema                 │
├───────────────────────────────────┼─────────────────────────────────────┤
│ Full canonical storage schema     │ Target schema returned by LLMs      │
│ Includes derived ordinals & IDs   │ OMIT derived ordinals & IDs         │
│ shot.index (1..N)                 │ Omits shot.index (array order only) │
│ speaker.ordinal (1..N)            │ Omits speaker.ordinal               │
│ subject.ordinal (1..N)            │ Omits subject.ordinal               │
│ Enforces complete entity graph    │ Prevents model sequencing hallucination│
└───────────────────────────────────┴─────────────────────────────────────┘
```

### Why Schemas Are Asymmetric:
If an LLM planner is asked to emit `index: 1`, `index: 2`, `ordinal: 1`, it frequently hallucinates gaps, duplicates, or out-of-order numbers. `PlannerOutputSchema` strips all derived identifiers from the LLM prompt. The deterministic assembler (`src/core/assemble.ts`) assigns stable IDs (`sp-1`, `shot-1`) and sequential indices after receipt.

### JSON Schema Export
- **`plannerJsonSchema()`**: Emits standard JSON Schema for the planner LLM call.
- **`patchJsonSchema()`**: Emits JSON Schema for surgical patch operations (`PatchOutputSchema`).

---

## 3. Path Addressing & The 19 Patchable Leaves (`src/core/ir/paths.ts`)

The engine provides a uniform addressing system for accessing and modifying any leaf inside `H3Document`.

### 3.1 Path Syntax & Functions
Paths use standard JavaScript property and array accessor syntax (e.g., `shots[0].beats[1].prose`).

- **`parsePath(path: string): PathSegment[]`**: Decomposes a path into keys and numeric indices (e.g. `['shots', 0, 'beats', 1, 'prose']`).
- **`formatPath(segments: PathSegment[]): string`**: Serializes segments back to accessor syntax.
- **`getAtPath(root: unknown, path: string): unknown`**: Safely retrieves the value at path.
- **`pathExists(root: unknown, path: string): boolean`**: Checks if the target path resolves.
- **`toPathPattern(path: string): string`**: Collapses concrete indices to `[]` (e.g. `shots[].beats[].prose`).
- **`isPatchable(path: string): boolean`**: Tests pattern against `PATCHABLE_LEAVES`.

---

### 3.2 The 19 `PATCHABLE_LEAVES` Catalog

To protect structural integrity, only 19 specific leaf patterns may be modified by patch operations:

| # | Patchable Leaf Pattern | Value Type | Description & Purpose |
|---|---|---|---|
| 1 | `style` | `string` | Medium, finish, and lighting description |
| 2 | `soundscape` | `string` | Overall ambient soundscape (1–4 sentences or `"N/A"`) |
| 3 | `music` | `string` | Non-diegetic music score (1–3 sentences or `"N/A"`) |
| 4 | `summary` | `string` | Ref2VA summary paragraph |
| 5 | `shots[].beats[].prose` | `string` | Beat narrative prose conditioning the model |
| 6 | `shots[].beats[].visibleText` | `string[]` | Verbatim text visible on screen (English quotes) |
| 7 | `shots[].beats[].dialogue.text` | `string` | Spoken dialogue words |
| 8 | `shots[].beats[].dialogue.language` | `string` | Spoken language tag (e.g. `"English"`) |
| 9 | `shots[].camera.type` | `CameraType` | One of the 20 documented camera movements |
| 10 | `shots[].camera.amplitude` | `Amplitude` | Camera motion amplitude (`'small'` or `'large'`) |
| 11 | `shots[].camera.speed` | `Speed` | Camera motion speed (`'slow'` or `'fast'`) |
| 12 | `shots[].cutAtMs` | `number` | Cut boundary timestamp in milliseconds |
| 13 | `subjects[].traits` | `string` | Physical traits of a defined Ref2VA subject |
| 14 | `subjects[].retention` | `VisualRetention` | Visual retention marker for subject |
| 15 | `subjects[].retentionNote` | `string` | Explanatory note for subject retention |
| 16 | `speakers[].descriptor` | `string` | Character voice introduction descriptor |
| 17 | `retention[].marker` | `VisualRetention` \| `AudioRetention` | Visual or audio retention marker |
| 18 | `retention[].note` | `string` | Context note for retention analysis |
| 19 | `slots[].description` | `string` | Human or vision description of reference media |

*Non-Patchable Fields*: Fields such as `id`, `order`, `index`, `ordinal`, `mode`, `durationSeconds`, and `schemaVersion` are strictly prohibited from `PATCHABLE_LEAVES`. Structural changes require dedicated pipeline operations.

---

### 3.3 Leaf Schema Shape Gate & Coercion (`src/core/ir/leaf.ts`)
- **`leafSchema(pattern: string): z.ZodType | null`**: Dynamically traverses `H3DocumentSchema`, unwrapping optional/nullable containers while preserving leaf type definitions.
- **`coerceToLeaf(leaf: z.ZodType, value: unknown): unknown`**:
  - Automatically parses numeric strings (e.g. `"4500"` $\rightarrow$ `4500` for `cutAtMs`).
  - Splits comma- or newline-separated strings into trimmed string arrays for array leaves (`splitList` for `visibleText`).

---

## 4. Closed Vocabularies (`src/core/ir/vocab.ts`)

All constant sets derive directly from the official MiniMax H3 prompt writing guides:

### 4.1 Modes & Contracts
- **`MODES`**: `['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA']`
- **`contractFor(mode)`**: Maps `'Ref2VA'` to `'ref2va'`; all other modes map to `'base'`.
- **`BASE_SECTIONS`**: `['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']`
- **`REF_SECTIONS`**: `['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']`

### 4.2 Camera Motion Vocabulary (20 Types)
`CAMERA_TYPES = [`
  `'Zoom In'`, `'Zoom Out'`, `'Push In'`, `'Pull Out'`,
  `'Pan Left'`, `'Pan Right'`, `'Truck Left'`, `'Truck Right'`,
  `'Tilt Up'`, `'Tilt Down'`, `'Pedestal Up'`, `'Pedestal Down'`,
  `'Arc Shot'`, `'Tracking Shot'`, `'Static Shot'`,
  `'Shake Slightly'`, `'Shake Strongly'`, `'POV'`,
  `'Roll Clockwise'`, `'Roll Counterclockwise'`
`]`
- **`AMPLITUDES`**: `['small', 'large']` (medium is implicit by omission).
- **`SPEEDS`**: `['slow', 'fast']` (normal is implicit by omission).

### 4.3 Dialogue Exact Tokens
- **`VOICEOVER_PHRASE`**: `'says in an off-screen voiceover'`
- **`CONTINUITY_PHRASES`**: `['continues in the next shot', 'continues across the cut', 'carries over to the next shot', 'resumes in the next shot']`
- **`SCENETRANS_TAG`**: `'<scenetrans>'` (placed at both ends of a cut-spanning line).
- **`CUTOFF_TAG`**: `'<cutoff>'` (marks speech truncated by the end of the video).
- **`DIALOGUE_ALLOWED_PUNCTUATION`**: `[',', '.', '?', '!', "'", '-']`
- **`DIALOGUE_TERMINALS`**: `['.', '?', '!']`
- **`UNCLEAR_MARKER`**: `'[unclear]'`

### 4.4 Reference Slots & Ceilings
- **`SLOT_CEILINGS`**: `{ image: 9, video: 3, audio: 3 }`
- **`SLOT_ROLES`** (20 roles):
  - *Frame Anchors* (images only): `first_frame`, `last_frame`, `keyframe`, `storyboard`
  - *Subject Content*: `identity`, `costume`, `prop`, `scene`, `style`, `lighting`, `motion_reference`, `attribute_transfer`
  - *Video Structure*: `edit_source`, `continuation_source`, `structure`
  - *Audio*: `voice`, `music_style`, `sfx`, `soundtrack_copy`

### 4.5 Task Types & Retention Markers
- **`TASK_TYPES`**: `['keyframe completion', 'reference generation', 'video editing', 'video continuation', 'audio reuse', 'audio reference']`
- **`VISUAL_RETENTION`**: `['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference']`
- **`AUDIO_RETENTION`**: `['fully_copy', 'partially_copy', 'reference', 'weak_reference']`

---

## 5. Related Articles

- **[Master Index](index.md)**: Topic index.
- **[Architecture & Pipeline](architecture.md)**: End-to-end execution flow.
- **[Patch Subsystem](core_patch.md)**: 4-gate verification and `setAtPath` implementation.
- **[Validation Engine](core_validate.md)**: Catalog of structural rules.
