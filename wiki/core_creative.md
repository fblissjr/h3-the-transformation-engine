# Creative Engine, Style Packs & Reference Anchors

[Back to Master Index](index.md) · [Glitch Marks Subsystem](glitch_marks.md) · [Wildcards Subsystem](wildcards.md) · [Architecture Guide](architecture.md) · [Core Invariants](invariants.md)

---

## 1. Architectural Role & Pipeline Boundaries

The Creative Engine (`src/core/creative/`) provides structured aesthetic, kinetic, finish, and auditory direction to the H3 prompt generation pipeline. It operates under two fundamental engineering boundaries established in `CLAUDE.md`:

1. **Planner conditioning, not serializer formatting:** Creative packs inject concrete, observable directives into the planner LLM's system prompt (via `buildPlannerSystemPrompt` in `src/provider/prompts/planner.ts`). They govern what the model is instructed to write into its beat prose, not how code serializes it. The deterministic serialization pipeline (`src/core/serialize/`) never expands an enum or pack ID into canned prose.
2. **Selection travels; derived text does not:** The runtime and persistent state stores only a `CreativeModeRecord` containing scalar identifiers and modes. The prompt directive text and display badges are pure functions computed dynamically at the point of use via `styleDirective(selection)` and `describeSelection(selection)`. Storing derived text alongside its source record is strictly forbidden because duplicate representations inevitably drift out of synchronization.
3. **Pure TypeScript kernel:** Following the repository's strict purity invariant (`test/purity.test.ts`), all modules in `src/core/creative/` have zero dependencies on React, browser DOM APIs, IndexedDB, network requests (`fetch`), or provider SDKs.

---

## 2. Creative Record Structure & Two-Halves Architecture

A creative configuration is represented by `CreativeModeRecord` (defined in `src/core/creative/types.ts`):

```ts
export interface CreativeModeRecord {
  mode: CreativeMode;
  selection: CreativeSelection;
  glitch?: GlitchSelection;
}
```

### The Two Independent Halves Invariant

A `CreativeModeRecord` carries two independent contributions:
1. **Style Selection (`selection`):** Visual medium, motion behavior, finish treatment, and audio treatment.
2. **Glitch Marks (`glitch`):** Rare tokenizer anomalies placed as on-screen text on physical surfaces.

Glitch marks are deliberately decoupled from the four style families. In `resolver.ts`, each style family is represented by a single scalar ID string. If glitch marks were treated as a fifth pack family, `sameSelection` would require list comparisons, converting scalar checks into reference comparisons and silently breaking change-detection badges.

All callers outside the creative module must inspect both halves together using unified record-level helpers:
- `hasDirection(record)`: Returns `true` if either `hasStyle(record.selection)` or `hasGlitch(record.glitch)` contributes prompt text.
- `sameRecord(a, b)`: Compares both `sameSelection(a.selection, b.selection)` and `sameGlitch(a.glitch, b.glitch)`.
- `describeRecord(record)`: Joins the human-readable style badge and glitch badge with `" + "`.
- `pruneRecord(record)`: Sanitizes both halves, dropping unresolvable IDs, normalizing strength to `'full'`, and pruning empty glitch token arrays to `undefined`.
- `withGlitch(base, glitch)`: Attaches a set of marks to a base record without accidentally dropping them during pack dropdown edits.

### Creative Modes

The engine defines three creative modes (`CreativeMode`):
- `'directed'`: Explicit manual selection of pack IDs across the visual, motion, finish, and audio families.
- `'wild'`: Algorithmic random selection constrained by leverage scoring and stress-test viability (`randomWild`).
- `'exploratory'`: Legacy preset mode containing 15 unvalidated combinations. Exploratory mode has been retired from the UI picker (`WritableCreativeMode = Exclude<CreativeMode, 'exploratory'>`), but remains accepted in storage unions. When loaded from storage, `pruneRecord` maps `'exploratory'` to `'directed'`.

### Strength Levels & Preamble Scoping

The influence of style direction is governed by `StrengthLevel`:
```ts
export type StrengthLevel = 'subtle' | 'full' | 'stress-test';
```

Strength is a scope of authority, not a volume slider. Each level injects a specific preamble into `styleDirective`:
- **`subtle`**: *"The direction below sets the medium and the finish. Take everything else -- subject, staging, and action -- from the request, and keep the treatment grounded."*
- **`full`**: *"The direction below governs the look. Where the request describes appearance in passing, the direction wins; the request still decides what happens and to whom. Apply it consistently across subjects, environment, lighting, and transitions."*
- **`stress-test`**: *"The direction below governs the look, and the request only decides what happens and to whom. Apply it to every visual layer: subject, crowd, vehicles, architecture, signage, pavement, reflections, atmosphere, smears, and transitions. Use at least 4-6 mutually reinforcing structural descriptors rather than loose adjective clouds."*

---

## 3. The Five Strength Axes & Leverage Scoring

MiniMax H3 video generation exhibits a strong default bias toward generic photorealism. To overcome this default and achieve a distinctive look, a style combination must exert mechanical leverage across multiple structural dimensions.

### The 5 Leverage Axes (`Axis`)

Defined in `src/core/creative/packs.ts`:
- **`G` (Geometry / Material Change):** Fundamental physical medium shift (e.g., clay, cut paper, wood, marble, liquid, sculpted forms).
- **`S` (Shape / Edge / Shadow Grammar):** Graphic contour rules, carved shadow planes, broken outlines, posterized value ramps, silhouette staging.
- **`P` (Palette / Value System):** Severe color constraints, 2–3 color limits, blacklight fluorescent palettes, two-tone monochrome, risograph separations.
- **`M` (Motion Grammar):** Non-naturalistic timing, snappy cartoon physics, squash-and-stretch, stepped stop-motion holds, rhythmic bounce.
- **`T` (Animated Texture / Process Artifacts):** Visible fabrication artifacts, line boil, pigment pooling, woodcut grain, cel dust, analog tape wobble, gate weave.

### Leverage Scoring & `isStressTestViable`

Scoring is computed in `src/core/creative/strength.ts`:
- `scoreStrength(selection)`: Merges all active axes across `visual`, `motion`, and `finish`. Audio packs carry `axes: []` because auditory treatments do not alter visual photorealism.
- `activeAxes(score)`: Counts active boolean flags across the 5 axes.
- **`isStressTestViable(score)` Rule:**
  ```ts
  export function isStressTestViable(score: StrengthScore): boolean {
    return activeAxes(score) >= 3 && (score.G || score.S);
  }
  ```
  A combination is viable for a stress-test if and only if:
  1. It activates **at least 3 of the 5 axes** (`activeAxes >= 3`).
  2. It is **anchored by either Geometry (`G`) or Shape (`S`)**. Texture (`T`), Palette (`P`), and Motion (`M`) alone inevitably collapse back into photorealism with a superficial post-processing filter.

---

## 4. Unified Visual ID Space & Reference Anchors

The visual medium selector operates on a unified identifier namespace (`VisualId = VisualPackId | AnchorId`) spanning 57 visual options:
- 27 visual medium packs (`V01`–`V27`)
- 30 style reference anchors (`R01`–`R30`)

The unified ordering is exposed in `VISUAL_SOURCES = [...VISUAL_PACKS, ...STYLE_ANCHORS]`. Lookup is handled transparently by `getVisual(id)` in `src/core/creative/visual.ts`.

### Legacy Numeric ID Tolerance

Prior builds stored reference anchors as raw numbers (e.g., `28` instead of `'R28'`). To prevent data loss when loading historic documents:
- `canonicalVisualId(id: string | number)` converts any numeric input to the `'R'`-prefixed format:
  ```ts
  export function canonicalVisualId(id: string | number): string {
    return typeof id === 'number' ? `R${String(id).padStart(2, '0')}` : id;
  }
  ```
- `H3DocumentSchema` accepts `z.union([z.string(), z.number()])` for the `visual` field.
- `getVisual` and `lines(selection)` automatically run `canonicalVisualId`, ensuring that old documents resolve cleanly and are migrated to `'R28'` on save.

---

## 5. Catalog of the 4 Pack Families (53 Packs Total)

Every pack in `src/core/creative/packs.ts` is defined as a `PackDef` (`id`, `name`, `directive`, `axes`).

### 5.1 Visual-Medium Packs (`VISUAL_PACKS`: V01–V27, 27 Packs)

| ID | Name | Directive Summary | Axes |
|---|---|---|---|
| `V01` | Classical hand-drawn cel | Clean key poses, confident contour lines, painted backgrounds, clear silhouette staging, natural overlap in hair and clothing. | S, T |
| `V02` | Limited television animation | Held poses, crisp key drawings, selective movement in eyes, mouth, and hair tips, small head turns, stable readable staging. | M |
| `V03` | Rubber-hose cartoon | High-contrast rubber-hose style, elastic limbs, rhythmic bounce, rounded poses, musical accents on physical impacts, simple graphic backgrounds. | S, M |
| `V04` | Silhouette cutout | Ornate black cutout animation, flat dark figures, patterned shapes, articulated paper joints, theatrical composition, layered parallax depth. | G, S |
| `V05` | Stop-motion puppet miniature | Handcrafted materials, miniature set depth, visible surface texture, stepped frame-to-frame movement, subtle registration variation. | G, T |
| `V06` | Clay animation | Softly sculpted forms, faint thumbprint texture, gentle surface wobble, tactile deformation on contact, practical miniature lighting. | G, T |
| `V07` | Paper collage and cutout | Layered paper collage, torn and cut edges, printed textures, shallow parallax, composited shadows, handmade depth. | G, T |
| `V08` | Pencil and watercolor | Pencil construction lines, translucent watercolor washes, visible paper fiber, soft pigment pooling, restrained color bleed, fluctuating hand-painted edges. | S, P, T |
| `V09` | Gouache paint-in-motion | Layered brush strokes, matte pigment, simplified painted shapes, visible bristle texture, controlled paint-like edge movement. | S, T |
| `V10` | Rotoscoped painterly realism | Lifelike timing and body-weight shifts, inked contours, painterly fill, subtle frame-to-frame drawing variation. | S, T |
| `V11` | Flat mid-century graphic | Modernist flat shapes, asymmetric composition, bold color blocks, sparse linework, selective limited movement. | S, P |
| `V12` | Comic print hybrid | Inked contours, halftone dots, offset color registration, graphic impact frames, stylized motion streaks, punchy panel-like composition. | S, P, T |
| `V13` | Psychedelic pop collage | Saturated flat pop-art color, drifting graphic layers, playful scale changes, decorative pattern, fluid surreal transitions. | S, P, T |
| `V14` | High-detail cinematic cel realism | Dense architectural cel detail, precise mechanical drawing, weighty body motion, atmospheric perspective, dramatic practical light sources. | S |
| `V15` | Painterly magical realism | Richly observed environments, warm natural light, grounded character acting, soft secondary motion, restrained fantastical detail. | S |
| `V16` | Atmospheric cyber-noir animation | Cool rain reflections, dense urban haze, precise sparse character movement, slow observational framing, luminous practical signage. | S, P |
| `V17` | Stylized feature CG | Clean topology, expressive controlled facial animation, smooth easing, natural secondary motion, cinematic lensing, soft PBR lighting. | *(none)* |
| `V18` | Stylized CG comedy | Bold facial shapes, snappy readable poses, controlled exaggeration, bright character separation, energetic coherent camera. | S, M |
| `V19` | Photoreal cinematic live action | Physically plausible materials, motivated practical lighting, natural skin and fabric response, restrained depth of field, coherent motion blur. | *(none)* |
| `V20` | Premium product commercial | Exact surface detail, controlled specular highlights, deliberate negative space, precise camera motion, clean reflections, disciplined brand presentation. | *(none)* |
| `V21` | Observational documentary | Available light, responsive framing, natural exposure variation, unforced blocking, environmental detail, restrained handheld movement. | *(none)* |
| `V22` | Archival newsreel | Period-appropriate framing, limited tonal range, intermittent exposure variation, mechanical camera steadiness, aged photographic texture. | T |
| `V23` | Vector motion design | Vector-clean geometric shapes, strict alignment, controlled easing curves, layered 2.5D parallax, readable typography zones, precise graphic transitions. | S |
| `V24` | Game-cinematic rendering | High-end real-time rendering, stable world geometry, readable silhouettes, controlled depth of field, responsive animation, coherent PBR materials. | *(none)* |
| `V25` | Handheld phone capture | Vertical framing, autofocus hunting between subjects, exposure stepping as the camera turns, rolling-shutter lean on fast pans, compression blocking in the shadows. | *(none)* |
| `V26` | Fixed surveillance capture | High static mounting, wide-angle edge distortion, uneven room coverage, one long unbroken take, subjects entering and leaving at the frame edges. | *(none)* |
| `V27` | Webcam and video call | Fixed near-eye-level framing, shallow small-sensor depth, uneven key from a screen, dropped frames on fast movement, compression smearing across motion. | *(none)* |

*Device Capture Note (V25–V27):* Packs V25–V27 describe degraded consumer recording devices rather than art-direction styles away from photorealism. Consequently, they deliberately claim zero leverage axes.

---

### 5.2 Motion Behavior Packs (`MOTION_PACKS`: M01–M08, 8 Packs)

| ID | Name | Directive Summary | Axes |
|---|---|---|---|
| `M01` | Naturalistic acting | Small anticipatory weight shifts, clean arcs, restrained gestures, breathing and eye focus preceding action, secondary motion settling after body. | *(none)* |
| `M02` | Limited held timing | Held key poses, selective facial and hair movement, sparse in-between action, brief stepped transitions. | M |
| `M03` | Snappy cartoon timing | Strong anticipation, rapid pose change, controlled squash and stretch, brief overshoot, clean held settle. | M |
| `M04` | Tactile stop-motion timing | Stepped stop-motion cadence, slight frame registration variation, minimal motion blur, tiny material shifts, deliberate pose increments. | M |
| `M05` | Weighty cinematic action | Clear preparation, believable momentum and resistance, strong contact points, trailing secondary motion, gradual deceleration after impact. | *(none)* |
| `M06` | Rhythmic performance | Body accents and camera reframes landing on audible beats, evolving movement motifs, resolving on closing beat. | M |
| `M07` | Graphic morphing | Shapes transforming through legible intermediate silhouettes, continuously flowing edges, exchanging color regions, stable graphic destination states. | G, M |
| `M08` | Product precision | One controlled object action at a time, exact contact and release, smooth constant-speed movement, minimal vibration, clean alignment. | *(none)* |

---

### 5.3 Finish Packs (`FINISH_PACKS`: F01–F09, 9 Packs)

| ID | Name | Directive Summary | Axes |
|---|---|---|---|
| `F01` | Clean digital | Stable exposure, crisp edges, minimal grain, neutral highlight rolloff, clean color separation. | *(none)* |
| `F02` | 35mm film | Fine film grain, mild highlight halation, soft contrast rolloff, subtle gate weave, restrained lens flare. | T |
| `F03` | 16mm reversal | Pronounced organic grain, compact highlight latitude, slight color drift, mild flicker, documentary film texture. | T |
| `F04` | VHS tape | Soft analog detail, light chroma bleed, faint scanline structure, intermittent tracking wobble, low-level tape noise. | T |
| `F05` | Paper and ink | Visible paper tooth, uneven ink density, restrained line boil, handmade registration variation. | T |
| `F06` | Watercolor and gouache | Paper fiber, pigment pooling, matte painted texture, soft edge variation, restrained color bleed. | T |
| `F07` | Print and collage | Halftone or screen-print texture, cut edges, layered shadows, imperfect registration, tactile compositing. | T, P |
| `F08` | Noir monochrome | Black-and-white tonal separation, deep controlled shadows, selective highlights, fine grain, minimal midtone haze. | P |
| `F09` | Sensor imaging | Single-channel tonal mapping, bloom around hot points, heavy gain noise across flat areas, hard clipping at the bright end, detail collapsing to silhouette at the dark end. | P |

---

### 5.4 Audio Treatment Packs (`AUDIO_PACKS`: A01–A09, 9 Packs)

Audio packs supply auditory directives to the planner. Because audio treatments do not alter visual photorealism, all audio packs carry `axes: []` and do not participate in `scoreStrength`.

| ID | Name | Directive Summary |
|---|---|---|
| `A01` | Natural synchronized realism | Synchronized footsteps, cloth contact, room tone, environmental depth. |
| `A02` | Tactile miniature foley | Small dry contacts, material creaks, tiny armature clicks, close-set room tone, restrained dynamics. |
| `A03` | Vintage cartoon orchestration | Synchronized instrumental accents matching physical impacts, scored action beats. |
| `A04` | Anime action sound design | Air displacements, cloth snaps, mechanical impacts, brief tonal accents on decisive poses. |
| `A05` | Product ASMR | Close handling sounds including cap clicks, fabric glide, glass contact, packaging folds, room silence. |
| `A06` | Documentary location sound | Location ambience, distant indistinct crowd murmur, environmental occlusion, natural mic perspective. |
| `A07` | Analog media audio | Low tape hiss, limited bandwidth, wow and flutter, mechanical transport noise. |
| `A08` | Graphic rhythm bed | Electronic percussion or acoustic clicks at stated tempo aligned to graphic transitions. |
| `A09` | Onboard device capture | Single onboard microphone perspective, wind buffeting across the capture, clipping on loud transients, room slap on close voices, rolled-off low end. |

---

## 6. Catalog of All 30 Style Reference Anchors (R01–R30)

Style reference anchors (`STYLE_ANCHORS` in `src/core/creative/anchors.ts`) translate cultural, historical, or studio aesthetics into concrete, observable craft traits. Their names avoid proprietary studio trademarks in favor of descriptive traits:

### Animation & Illustration Anchors (R01–R20)

| ID | Name | Directive Summary | Axes |
|---|---|---|---|
| `R01` | Early surreal line animation | Thin monochrome drawn lines, restless line boil, sparse staging, playful metamorphosis through clear intermediate shapes, quick pose changes, paper texture, and slight frame flicker. | T |
| `R02` | Early theatrical character acting | Classic hand-drawn character acting with stage-like framing, clean silhouettes, deliberate anticipation, readable performance beats, and complete settles. | *(none)* |
| `R03` | Ornate silhouette fantasy | Ornate black silhouette figures, decorative patterned environments, articulated cut-paper motion, theatrical profiles, and layered parallax depth. | G, S |
| `R04` | Jazz-age rubber-hose | Monochrome rubber-hose animation with elastic limbs, looping rhythmic bounce, musical action accents, high-contrast shapes, and gentle gate weave. | S, M |
| `R05` | Golden-age storybook cel | Polished hand-drawn cel acting, smooth arcs, painterly storybook backgrounds, warm soft light, strong staging, and natural overlap in hair and clothing. | S |
| `R06` | Urban surrealism | Gritty high-contrast ink animation, urban jazz-age settings, rubber-hose motion, surreal visual gags, quick comic snaps, projector flicker, and vintage contrast. | S |
| `R07` | Theatrical cartoon comedy | Bold facial shapes, strong key poses, sharp comic timing, controlled smear drawings, elastic squash and stretch, and uncluttered readable staging. | S, M |
| `R08` | Precision slapstick chase | High-energy chase choreography, large anticipations, explosive but readable impacts, exaggerated physical reactions, rapid recoveries, and precise action-sound synchronization. | *(none)* |
| `R09` | Mid-century graphic modernism | Flat modernist shapes, asymmetric composition, bold restrained color blocks, simplified environments, selective limited movement, and crisp poster-like staging. | S, P |
| `R10` | Antique puppet stop-motion | Antique miniature puppet performance, handcrafted sets, stepped pose increments, subtle registration jitter, tiny lighting variation, soft shadows, and aged film texture. | G, T |
| `R11` | Psychedelic pop collage | Saturated pop-art color, drifting cutout layers, decorative pattern, surreal scale changes, playful graphic transitions, and screen-printed texture. | S, P, T |
| `R12` | Foundational television anime | Clean line art, flat cel shading, held key poses, selective eye and mouth movement, sparse efficient backgrounds, and dialogue-forward composition. | S |
| `R13` | Neo-Tokyo high-detail cel realism | Dense architectural cel detail, grounded mechanical drawing, weighty human and vehicle movement, neon practical light, atmospheric urban haze, and cinematic camera placement. | S |
| `R14` | Atmospheric cyber-noir anime | Cool rain-soaked reflections, luminous signage, dense urban atmosphere, contemplative pacing, precise minimal acting, slow motivated camera movement, and restrained bloom. | S, P |
| `R15` | Painterly Japanese magical realism | Richly painted environments, warm natural light, grounded expressive acting, gentle arcs, soft secondary movement, everyday material detail, and restrained magical transformation. | S |
| `R16` | Prime-time animated sitcom | Stable sitcom staging, clean flat color, consistent line weight, held body poses, selective mouth and eye animation, and clear shot-reverse-shot blocking. | *(none)* |
| `R17` | Polished feature CG acting | Stylized feature-quality CG acting, smooth easing, clean arcs, expressive but controlled faces, natural hair and cloth overlap, motivated camera movement, and soft cinematic lighting. | *(none)* |
| `R18` | Snappy CG character comedy | Bold CG facial expressions, punchy readable poses, fast anticipation and settle, energetic but controlled camera movement, bright character separation, and crisp material response. | *(none)* |
| `R19` | Cinematic tactile stop-motion | Stepped stop-motion cadence, subtle puppet registration variation, handcrafted fabric and painted surfaces, miniature-scale depth of field, practical falloff, and tiny exposure flicker. | G, T |
| `R20` | Comic-halftone stepped hybrid | Inked comic contours, halftone shading, offset color accents, stepped timing on key beats, graphic impact frames, stylized motion streaks, and dynamic panel-like camera composition. | S, P, T |

### Live-Action, Commercial & Game Anchors (R21–R30)

| ID | Name | Directive Summary | Axes |
|---|---|---|---|
| `R21` | Symmetrical storybook live action | Precise centered compositions, planar camera movement, controlled pastel production design, theatrical blocking, carefully arranged props, dry visual timing, and restrained film texture. | *(none)* |
| `R22` | Neon urban neo-noir | Photoreal night exteriors, wet reflective surfaces, deep shadow separation, colored practical lights, volumetric haze, slow investigative camera movement, and restrained anamorphic flare. | *(none)* |
| `R23` | Premium technology commercial | Precise product geometry, dark controlled environment, narrow moving highlights, macro surface detail, slow exact camera arcs, clean negative space, and sparse high-definition handling sounds. | *(none)* |
| `R24` | Beauty and fragrance campaign | Soft sculpted light, controlled skin and glass highlights, shallow macro focus, elegant slow gesture, drifting atmospheric particles, deliberate negative space, and refined material detail. | *(none)* |
| `R25` | Sportswear kinetic commercial | Decisive athletic movement, low tracking angles, short motivated speed changes, crisp silhouettes, visible fabric response, grounded impacts, and rhythmic edit accents. | *(none)* |
| `R26` | Observational documentary | Available-light realism, responsive handheld framing, natural exposure shifts, unforced behavior, imperfect foreground occlusion, location ambience, diegetic sound only. | *(none)* |
| `R27` | 1970s 16mm documentary | Handheld 16mm photography, pronounced organic grain, compact highlight latitude, slight color drift, practical zoom behavior, natural location sound, and restrained editorial cutting. | T |
| `R28` | 1990s camcorder memory | Consumer camcorder framing, soft tape detail, chroma bleed, auto-exposure pumping, occasional tracking instability, onboard-microphone perspective, and low tape hiss. | T |
| `R29` | Third-person gameplay readability | Third-person follow framing, stable horizon, controlled orbit, readable collision spacing, clear character silhouette, responsive acceleration, and minimal cinematic blur. | *(none)* |
| `R30` | Stylized game cinematic | High-end real-time rendering, cinematic character blocking, controlled physically based materials, readable action choreography, motivated camera tracking, and coherent environmental effects. | *(none)* |

---

## 7. Random Selection Constraints & `randomWild`

When generating a random combination in wild mode (`randomWild` in `src/core/creative/resolver.ts`):
1. **High-leverage visual filtering:** Visual packs are drawn exclusively from `HIGH_LEVERAGE_VISUALS`—the subset of `VISUAL_PACKS` possessing either Geometry (`G`) or Shape (`S`) axes:
   ```ts
   const HIGH_LEVERAGE_VISUALS: VisualId[] = VISUAL_PACKS
     .filter((p) => p.axes.some((a) => a === 'G' || a === 'S'))
     .map((p) => p.id);
   ```
2. **Exclusion of Reference Anchors:** Reference anchors (`R01`–`R30`) are deliberately **excluded** from `randomWild`. Anchors carry specific historical and cultural associations (e.g., "jazz-age rubber-hose" or "symmetrical storybook") that require deliberate artistic intent rather than random assignment.
3. **Bounded Retries:** The algorithm performs up to 20 randomized draw attempts, seeking a selection that satisfies `isStressTestViable(scoreStrength(selection))`.
4. **Deterministic Fallback:** If 20 attempts fail to find a viable score, `randomWild` falls back to a certified high-leverage combination:
   ```ts
   {
     mode: 'wild',
     selection: {
       visual: 'V04',  // Silhouette cutout (G, S)
       motion: 'M07',  // Graphic morphing (G, M)
       finish: 'F07',  // Print and collage (T, P)
       audio: 'A08',   // Graphic rhythm bed
       strength: 'stress-test'
     }
   }
   ```
5. **Separation from Glitch Draws:** `randomWild` never draws glitch marks. Glitch marks insert literal text tokens onto surfaces in the frame; adding text to a scene is a distinct artistic choice that must be requested explicitly via `randomGlitch` rather than bundled into a style shuffle.

---

## 8. Verification & Integration Tests

The creative subsystem is verified by comprehensive unit and integration suites:
- **`test/creative.test.ts`:**
  - Derivation totality over missing and unknown IDs (`styleDirective`, `describeSelection`).
  - Single-source table validation: verifies that every pack ID in tables matches its type and claims valid axes.
  - Viability rules: tests `isStressTestViable` across all axis permutations.
  - `canonicalVisualId`: verifies conversion of legacy numeric IDs (`28` -> `'R28'`).
  - Record functions: verifies that `sameRecord`, `hasDirection`, `describeRecord`, and `pruneRecord` read both style and glitch halves.
- **`test/creative-integration.test.ts`:**
  - Asserts that both `buildPlannerSystemPrompt` and `buildPatchSystemPrompt` derive identical style directive text from the same `CreativeModeRecord`.
  - Verifies that style directives appear in the prompt when configured and are omitted when `creativeMode` is absent.
