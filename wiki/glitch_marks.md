# Glitch Marks Subsystem

[Back to Master Index](index.md) · [Creative Engine](core_creative.md) · [Wildcards Subsystem](wildcards.md) · [Validation Engine](core_validate.md) · [Postmortems & Lessons Learned](postmortems_lessons.md)

---

## 1. Overview & Theoretical Foundation

The Glitch Marks subsystem (`src/core/creative/glitch.ts`) implements the **Glitch Token Infusion** technique. A glitch token is an ultra-rare string from the underlying language model tokenizer's training corpus—a string that appeared so infrequently, and in such narrow syntactic contexts (e.g., bulk-scraped web page furniture, telemetry logging IDs, bot handles), that its vector embedding occupies abnormal, unoptimized perimeter edges of latent space.

When one of these strings is deliberately injected into a video generation scene as a physical on-screen mark, it behaves as an unauthored, unexplained anomaly:
- Legible and crisp.
- Not attributable to any character or author in the scene.
- Unnoticed and unremarked upon by subjects in the scene.

### Distinction from "Glitch Art"

Glitch token infusion has nothing to do with visual corruption, datamoshing, scanline jitter, or pixel tearing. Those aesthetic treatments are provided separately by finish packs (such as `F04` VHS tape or `F09` Sensor imaging in `src/core/creative/packs.ts`). Glitch marks, by contrast, are intact, pristine lexical anomalies etched into the physical world of the video.

### Provenance & Adaptation

The technique originates from the Sora 2 dual-stage prompt architect (Glitch Token Infusion Edition) and its standalone storyboard-rewriter sibling. The H3 Transformation Engine ports the **placement grammar** and **safety invariants** while rejecting worked examples that relied on imperial camera measurements, raw timecodes, and lens focal lengths, which are either computed deterministically by the engine or absent from the official MiniMax H3 vocabulary (`src/core/ir/vocab.ts`).

---

## 2. Token Palette: The 10 Defined Tokens (`GLITCH_TOKENS`)

Defined in `src/core/creative/glitch.ts`, the subsystem maintains exactly 10 tokens: 8 drawable tokens and 2 skewed tokens.

Unlike pack IDs where short codes map to descriptive names, **a glitch token's ID IS the token string itself** (`t.id === token`). Because the identifier and the payload are identical, the stored ID and prompt payload can never disagree.

```ts
export interface GlitchTokenDef {
  readonly id: string;
  readonly note: string;
  readonly skew?: string;
}
```

### 2.1 Drawable Tokens (`DRAWABLE_TOKENS`: 8 Tokens)

The 8 tokens without latent skews form `DRAWABLE_TOKENS` (`GLITCH_TOKENS.filter((t) => !('skew' in t))`). These are safe for randomized selection in `randomGlitch`:

1. `"SolidGoldMagikarp"`: The canonical tokenizer anomaly. A Reddit username scraped in bulk that was never used in natural prose.
2. `"GoldMagikarp"`: The truncated sibling variant of `"SolidGoldMagikarp"`. Offered as an independent stylistic variant, not derived by string manipulation.
3. `"embedreportprint"`: A concatenated web interface button fragment with zero natural grammatical context.
4. `"rawdownload"`: A markup and URL fragment extracted from bulk-scraped web furniture.
5. `"oreAndOnline"`: A boundary splitting artifact, severed across an arbitrary phrase boundary that was never an individual word.
6. `"TPPStreamerBot"`: A dedicated Twitch/Reddit forum bot handle from a single high-volume thread, unseen anywhere else.
7. `"PsyNetMessage"`: A proprietary telemetry logging identifier from gaming network dumps.
8. `"RandomRedditorWithNo"`: A truncated username handle whose enclosing sentence never appeared in prose.

### 2.2 Skewed & Fenced Tokens (2 Tokens)

Two tokens possess documented semantic attractors strong enough to warp the thematic direction of the entire scene. They are deliberately fenced off: offered only for explicit manual selection, and strictly excluded from random draws (`randomGlitch`):

1. `"petertodd"`:
   - *Note:* The most widely documented anomalous string in tokenizer literature.
   - *Skew:* Pulls hard negative valence and adversarial context into the generated scene.
2. `"Leilan"`:
   - *Note:* The counter-balancing anomalous string.
   - *Skew:* Attracts strong lunar, mystical, and deity readings that color the entire scene's environment.

---

## 3. Physical Placement Surfaces (`GLITCH_SURFACES`: 6 Surfaces)

The subsystem defines exactly 6 physical surfaces where a mark may exist in the scene. Defined as `GlitchSurfaceDef` in `src/core/creative/glitch.ts`:

```ts
export interface GlitchSurfaceDef {
  readonly id: string;
  readonly name: string;
  readonly directive: string;
}
```

1. **`inscription` ("Inscription"):** Carved, etched, or painted into an existing environmental fixture: a wall, a brass plaque, a copper plate, a paving stone.
2. **`reflection` ("Reflection"):** Readable only in glass, standing water, chrome, or a powered-off dark monitor screen, belonging to the reflection rather than the object.
3. **`overlay` ("Interface overlay"):** A display element that flickers across an in-scene terminal or HUD inside the scene, never on the camera lens or composite image.
4. **`stamp` ("Stamp"):** Printed on manufactured packaging, an industrial shipping crate, a transit ticket, a livery panel, or a cargo label.
5. **`etching` ("Etching"):** Marked at miniature scale, such as a serial number on an instrument, a mechanical caliper, or a precision gauge face.
6. **`wear` ("Wear"):** Faded, peeling, scratched, or partially abraded, reading as significantly older than the surrounding surfaces.

### Retirement of "Whispered Metadata"

The original Sora 2 rewriter design proposed a seventh placement surface: "whispered metadata". This surface was **permanently retired and deleted** in the H3 Transformation Engine. 

In MiniMax H3, instructing the planner model to describe a vocal act on a beat without explicit `<d/>` dialogue inevitably causes the model to hallucinate unconstrained spoken dialogue. To eliminate this failure mode, vocal placement was eliminated, and the miniature physical marking it aimed for was formalized as `etching`.

---

## 4. Subsystem Constants & Operational Rules

### Token Ceiling (`GLITCH_MAX_TOKENS = 3`)

A video prompt may contain at most **3 glitch marks** (`GLITCH_MAX_TOKENS = 3`). Past three tokens, the marks cease to read as uncanny world anomalies and begin to resemble a branded font or decorative graphic motif. This ceiling is enforced programmatically in `resolvedTokens` and `pruneGlitch`.

### Registers: `motif` vs. `ood`

`GlitchRegister` controls how far the anomalous flavor reaches into the planner's descriptive vocabulary:
- **`motif` (Default):** The scene remains in its ordinary descriptive register. The glitch marks are the solitary anomaly in the frame, effective precisely because nothing around them strains for strangeness.
- **`ood` (Out-of-Distribution):** Instructs the planner to select less common, unexpected physical choices wherever two options serve equally well (materials, light angles, placement), while remaining strictly concrete and recordable by a camera. Abstract mood words remain forbidden.

### Invariant On-Screen Text Formatting

In the H3 prompt architecture:
1. **A glitch mark is on-screen text:** Every mark must be written into beat prose (`shots[].beats[].prose`) inside English double quotes (`"..."`) and declared in `shots[].beats[].visibleText`.
2. **Validator Enforcement:** This is enforced by the existing validation rule `visibleTextQuoted` in `src/core/validate/rules/speech.ts`. No special-case validation rule is needed.
3. **Punctuation & Capitalization Discipline:** A mark must never be truncated, split, hyphenated, spaced out, or case-modified. Characters in the video must never read a mark aloud, point at one, react to one, or be puzzled by one.

### Prohibition in Style, Identity, and Retention

Glitch marks belong strictly to the transient temporal moment in which they appear:
- **Prohibited in `style`:** Must never appear in the overall medium/finish style clause.
- **Prohibited in `subjects[].traits`:** Must never be attached to character identity or visual appearance.
- **Prohibited in `retention`:** Must never be cited in `retention[].note` or `retention[].context`.

---

## 5. Mode Placement Constraints (`GLITCH_MODE_NOTES`)

Placement constraints vary across the 5 MiniMax H3 generation modes. Because reference pictures define ground-truth frames, injecting an unauthored mark into a reference frame produces severe visual contradictions.

These rules are maintained in `GLITCH_MODE_NOTES` (`src/provider/prompts/planner.ts`):

- **`T2VA` (Text-to-Video):**
  > *"Nothing in this scene is fixed by a reference, so a mark can go anywhere the world would plausibly carry one."*
- **`I2VA` (Image-to-Video):**
  > *"`<Picture 1>` is the actual first frame and does not contain a mark. Do not place one in it or describe one as visible there. Marks appear after the opening beat, on surfaces the image establishes or on ones that come into frame later."*
- **`FL2VA` (First-and-Last-Frame-to-Video):**
  > *"Both pictures are actual frames and neither contains a mark. Marks live on the path between them: one appears after the opening beat and is gone, out of frame, or turned away before the final beat lands on Picture 2."*
- **`L2VA` (Last-Frame-to-Video):**
  > *"`<Picture 1>` is the actual final frame and does not contain a mark. Marks belong to the earlier state you infer, and none of them is visible in the last beat."*
- **`Ref2VA` (Reference-to-Video):**
  > *"Marks go on the environment only. Never put one on a referenced subject, and never on a surface an asset supplies -- the references do not contain these strings, and a subject definition or a retention note that mentions one is claiming they do. Keep them out of the summary for the same reason."*

---

## 6. Derivations & Directives

### `glitchDirective(glitch)`

The directive block spliced into the system prompt is a pure function of `StoredGlitch` (implemented in `src/core/creative/glitch.ts`):
- Resolves tokens against `GLITCH_TOKENS`, deduplicating and applying the 3-token ceiling.
- If no valid tokens survive, returns `null`.
- Assembles placement surface instructions (single surface, distinct per mark, or fallback).
- Appends invariant placement, punctuation, and register clauses (`REGISTER_CLAUSE`).

Both the planner prompt (`buildPlannerSystemPrompt`) and the patch prompt (`buildPatchSystemPrompt`) derive identical text from `glitchDirective`, verified by `test/creative-integration.test.ts`.

### `pruneGlitch(glitch)`

Sanitizes a glitch record restored from storage:
- Resolves token and surface IDs against known tables.
- **Empty list collapsing:** An empty token array (`tokens: []`) is pruned to `undefined`. In the UI state, `tokens: []` and no glitch record at all must not exist as separate states; otherwise, change badges falsely claim an edit will alter glitch marks.

### `randomGlitch(random)`

Generates a randomized selection of 1 to 3 marks from `DRAWABLE_TOKENS`, assigning a distinct surface to each from `GLITCH_SURFACES`. The register is always initialized to `'motif'` because switching to `'ood'` fundamentally alters every sentence in the clip and should only be chosen intentionally.

---

## 7. Verification & Historical Traps

The glitch marks subsystem is verified in `test/creative.test.ts`:
- Token palette completeness and deduplication up to `GLITCH_MAX_TOKENS`.
- Separation of `DRAWABLE_TOKENS` from skewed tokens (`"petertodd"`, `"Leilan"`).
- Surface resolution and fallback behavior.
- Invariant double-quoting and `visibleText` inclusion.

### Historical Lessons Learned

1. **The Off-Button Bug (Session 2026-08-28):** When clicking the "Off" button in `CreativePanel`, the handler attempted to preserve glitch marks by returning a new `CreativeModeRecord`. But because a record requires a mode, it defaulted to `mode: 'directed'`. This lit up the Directed button, opened directed controls, and made pressing Off a second time a no-op. The fix decoupled glitch state handling and established the two-halves rule (`withGlitch`).
2. **Mode Notes in Shared Directives:** The active generation mode is known to the planner prompt, but unknown to the patch prompt. Mode-specific placement notes must live in `GLITCH_MODE_NOTES` inside `planner.ts`, keeping `glitchDirective` total on `StoredGlitch` alone.
