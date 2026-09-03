# Validation Engine & Complete Diagnostic Catalog

The **Validation Engine** (`src/core/validate/`) provides comprehensive, deterministic structural validation for the H3 Intermediate Representation. It enforces every machine-checkable syntactic rule defined by the official MiniMax H3 prompt writing guides.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Invariants](invariants.md) | [Intermediate Representation](core_ir.md)

---

## 1. Architectural Principles (`src/core/validate/types.ts`, `index.ts`)

### 1.1 Errors Only (Zero Warning Severity)
The validation engine intentionally eliminates the concept of warnings:
- **Provably Malformed**: A diagnostic is emitted if and only if the document is provably malformed according to the H3 specification (e.g. cut time outside video duration, undeclared speaker ID, illegal camera type, unclosed `<scenetrans>` tag). Every diagnostic represents a hard compilation error.
- **Elimination of Subjective Rules**: 17 historical rules that pattern-matched free prose for subjective stylistic preferences (e.g. grading sentence count in soundscapes or word counts in descriptions) were permanently deleted. Subjective guidance belongs in planner prompts where failure carries zero cost.

### 1.2 Total Rule Isolation (`RULE_THREW`)
Rules are pure and executed independently. A bug or unexpected exception in one rule must never crash the pipeline or suppress other diagnostics:

```typescript
export function validate(
  doc: H3Document,
  ctx: NormalizedContext,
  rules: Rule[] = ALL_RULES,
): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    try {
      diagnostics.push(...rule(doc, ctx));
    } catch (cause) {
      diagnostics.push({
        code: 'RULE_THREW',
        path: '',
        message: `Validation rule "${rule.name || 'anonymous'}" threw: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      });
    }
  }

  return { diagnostics, ok: diagnostics.length === 0 };
}
```

### 1.3 Path Addressing & Editor Grouping
Each `Diagnostic` carries a stable machine-readable `code`, human-readable `message`, and document `path` (matching `ir/paths.ts` and serializer `SourceSpan.path`). The helper `byPath(diagnostics)` groups diagnostics by document path for real-time inline badge display in the UI editor.

---

## 2. Complete Catalog of All 29 Validation Rules

The engine executes exactly 29 rule functions partitioned across three modules:

```
┌────────────────────────────────────────────────────────────────────────┐
│                     The 29 Pure Validation Rules                       │
├────────────────────────┬───────────────────────┬───────────────────────┤
│ Timeline Rules (9)     │ Speech Rules (11)     │ Section Rules (9)     │
│ (rules/timeline.ts)    │ (rules/speech.ts)     │ (rules/sections.ts)   │
├────────────────────────┼───────────────────────┼───────────────────────┤
│ 1. shotsPresent        │ 10. speakerOrdinals   │ 21. slotCeilings      │
│ 2. durationPositive    │ 11. speakerAssignment │ 22. slotRoles         │
│ 3. shotIndices         │ 12. speakerReferences │ 23. slotOrdering      │
│ 4. shotTimestamps      │ 13. speakerIntroduced │ 24. refSummary        │
│ 5. cutTimes            │ 14. compoundSpeakers  │ 25. refSummaryLabels  │
│ 6. shotsHaveBeats      │ 15. dialoguePlacement │ 26. refRetentionCover │
│ 7. modeMatchesSlots    │ 16. dialoguePunct     │ 27. refRetentionClass │
│ 8. cameraTypeValid     │ 17. voiceover         │ 28. refNoSpeakerInRet │
│ 9. frameRolesOnImages  │ 18. crossCutDialogue  │ 29. refLabelsDefined  │
│                        │ 19. cutoffPlacement   │                       │
│                        │ 20. visibleTextQuoted │                       │
└────────────────────────┴───────────────────────┴───────────────────────┘
```

### 2.1 Timeline Rules (`src/core/validate/rules/timeline.ts` — 9 Rules)
1. **`shotsPresent`**: Verifies `doc.shots.length > 0`.
2. **`durationPositive`**: Verifies `doc.durationSeconds > 0`.
3. **`shotIndices`**: Verifies `shot.index === i + 1` contiguously across all shots.
4. **`shotTimestamps`**: Verifies Shot 1 has `cutAtMs === null` and Shot 2+ has `cutAtMs !== null`.
5. **`cutTimes`**: Verifies cut timestamps strictly increase (`cutAtMs > previous`) and fall within duration (`cutAtMs <= ctx.latestCutMs`).
6. **`shotsHaveBeats`**: Verifies `shot.beats.length > 0` for every shot.
7. **`modeMatchesSlots`**: Verifies attached slot counts and roles match mode requirements (`T2VA`: 0 slots; `I2VA`: 1 image with `first_frame`; `FL2VA`: 2 images with `first_frame` and `last_frame`; `L2VA`: 1 image with `last_frame`; `Ref2VA`: $\ge 1$ slot).
8. **`cameraTypeValid`**: Verifies `shot.camera.type` is one of the 20 documented `CAMERA_TYPES`.
9. **`frameRolesOnImages`**: Verifies frame anchor roles (`first_frame`, `last_frame`, `keyframe`, `storyboard`) appear only on image slots.

### 2.2 Speech Rules (`src/core/validate/rules/speech.ts` — 11 Rules)
10. **`speakerOrdinals`**: Verifies `speaker.ordinal === i + 1` contiguously across all declared speakers.
11. **`speakerAssignmentOrder`**: Verifies speaker ordinals reflect the order of actual vocal events in beat prose.
12. **`speakerReferences`**: Verifies attributed `speakerId` exists in `doc.speakers`, and the expected `speakerRef(speaker)` string appears in beat prose.
13. **`speakerIntroduced`**: Verifies non-compound speakers have a non-empty physical `descriptor`.
14. **`compoundSpeakers`**: Verifies compound speakers have $\ge 2$ members, do not contain themselves, and reference existing speaker IDs.
15. **`dialoguePlacement`**: Verifies agreement between `beat.dialogue` and the `<d/>` substitution placeholder in beat prose.
16. **`dialoguePunctuation`**: For non-user-supplied dialogue, verifies complete statements end in `.`, `?`, or `!` (exempting cut-starts, cutoffs, and fragments), and forbids decorative/repeated punctuation (`~`, `•`, `...`, `!!`, emoji).
17. **`voiceover`**: Verifies voiceover dialogue beat prose contains the exact phrase `"says in an off-screen voiceover"`.
18. **`crossCutDialogue`**: Verifies equal counts of `starts` and `continues` cuts, and ensures both sides contain `<scenetrans>`.
19. **`cutoffPlacement`**: Verifies `cutoff` flag and `<cutoff>` tag appear only on the final beat of the timeline.
20. **`visibleTextQuoted`**: Verifies every string in `beat.visibleText` appears verbatim inside English double quotes in beat prose.

### 2.3 Section Rules (`src/core/validate/rules/sections.ts` — 9 Rules)
21. **`slotCeilings`**: Verifies attached media slots do not exceed `SLOT_CEILINGS` (image: 9, video: 3, audio: 3).
22. **`slotRoles`**: Verifies every reference slot has at least one assigned role.
23. **`slotOrdering`**: Verifies slot `order` indices run contiguously $0..N-1$.
24. **`refSummary`**: In Ref2VA, verifies non-empty `summary`, non-empty `taskTypes`, and no duplicate task types.
25. **`refSummaryLabels`**: In Ref2VA, verifies summary does not cite reference labels not declared in `subject_definitions`.
26. **`refRetentionCoverage`**: In Ref2VA, verifies every defined subject and standalone slot has a corresponding entry in `retention_analysis`.
27. **`refRetentionMarkerClass`**: In Ref2VA, verifies audio targets use `AUDIO_RETENTION` markers and visual targets use `VISUAL_RETENTION` markers.
28. **`refNoSpeakerInRetention`**: In Ref2VA, verifies speaker IDs (e.g. `(S1)`) never appear inside retention notes or context.
29. **`refLabelsDefined`**: In Ref2VA, verifies all labels cited in beat prose (`<Subject N>`, `<Picture N>`, `<Video N>`, `<Audio N>`) were defined in `subject_definitions`.

---

## 3. Complete Catalog of All 36 Diagnostic Codes

Every diagnostic code is stable and covered by a red-proving test control in `test/validate.test.ts`:

| # | Diagnostic Code | Rule Module | Trigger Condition | Test Base Fixture | Mutation Trigger in `CONTROLS` |
|---|---|---|---|---|---|
| 1 | `NO_SHOTS` | `timeline.ts` | `doc.shots.length === 0` | `t2vaBaker` | `d.shots = []` |
| 2 | `DURATION_NOT_POSITIVE` | `timeline.ts` | `doc.durationSeconds <= 0` | `t2vaBaker` | `d.durationSeconds = 0` |
| 3 | `MODE_SLOT_MISMATCH` | `timeline.ts` | Slots contradict mode requirements | `t2vaBaker` | Push image slot to T2VA document |
| 4 | `SHOT_INDEX_NOT_SEQUENTIAL` | `timeline.ts` | `shot.index !== i + 1` | `t2vaBaker` | `d.shots[0].index = 3` |
| 5 | `SHOT_1_HAS_TIMESTAMP` | `timeline.ts` | Shot 1 has non-null `cutAtMs` | `t2vaBaker` | `d.shots[0].cutAtMs = 1000` |
| 6 | `SHOT_MISSING_TIMESTAMP` | `timeline.ts` | Shot >1 has null `cutAtMs` | `t2vaBaker` | `d.shots[1].cutAtMs = null` |
| 7 | `CUT_NOT_INCREASING` | `timeline.ts` | Cut time $\le$ previous cut time | `ref2vaCoffeeShop` | `d.shots[2].cutAtMs = 1000` |
| 8 | `CUT_OUTSIDE_DURATION` | `timeline.ts` | Cut time > `latestCutMs` | `t2vaBaker` | `d.shots[1].cutAtMs = 99_000` |
| 9 | `SHOT_NO_BEATS` | `timeline.ts` | `shot.beats.length === 0` | `t2vaBaker` | `d.shots[0].beats = []` |
| 10 | `CAMERA_TYPE_INVALID` | `timeline.ts` | Camera motion not in `CAMERA_TYPES` | `t2vaBaker` | `camera.type = 'Barrel Roll'` |
| 11 | `FRAME_ROLE_ON_NON_IMAGE` | `timeline.ts` | Frame role on video/audio slot | `ref2vaCoffeeShop` | Add `first_frame` to video slot |
| 12 | `SPEAKER_ORDINALS_NOT_SEQUENTIAL` | `speech.ts` | `speaker.ordinal !== i + 1` | `t2vaBaker` | `d.speakers[0].ordinal = 5` |
| 13 | `SPEAKER_ORDER_WRONG` | `speech.ts` | Speaker ordinals do not match vocal order | `ref2vaCoffeeShop` | Swap speaker 0 and 1 ordinals |
| 14 | `SPEAKER_UNDECLARED` | `speech.ts` | Beat references undeclared speaker ID | `t2vaBaker` | `speakerId = 'ghost'` |
| 15 | `SPEAKER_REF_MISSING_IN_PROSE` | `speech.ts` | Beat prose omits `(S1)` tag | `t2vaBaker` | Replace `(S1)` with `'she'` |
| 16 | `SPEAKER_NOT_INTRODUCED` | `speech.ts` | Speaker has empty descriptor | `t2vaBaker` | `descriptor = ''` |
| 17 | `COMPOUND_SPEAKER_INVALID` | `speech.ts` | <2 members, self-reference, or bad ID | `t2vaBaker` | Single member in `compoundOf` |
| 18 | `DIALOGUE_PLACEHOLDER_MISSING` | `speech.ts` | Beat has dialogue but prose lacks `<d/>` | `t2vaBaker` | Remove `<d/>` from prose |
| 19 | `DIALOGUE_PLACEHOLDER_ORPHAN` | `speech.ts` | Prose has `<d/>` but beat has no dialogue | `t2vaBaker` | Append `<d/>` to beat 0 prose |
| 20 | `DIALOGUE_BAD_TERMINAL` | `speech.ts` | Utterance lacks `.`, `?`, `!` terminal | `t2vaBaker` | Remove trailing period |
| 21 | `DIALOGUE_DECORATIVE_PUNCT` | `speech.ts` | Dialogue has tildes, repeated marks, emoji | `t2vaBaker` | Add `!!!` to dialogue text |
| 22 | `VOICEOVER_PHRASE_MISSING` | `speech.ts` | Prose lacks voiceover phrase | `voiceoverBaker` | Replace voiceover phrase with `'says'` |
| 23 | `SCENETRANS_UNPAIRED` | `speech.ts` | Unpaired `starts`/`continues` or no `<scenetrans>` | `crossCutBaker` | Delete `crossesCut` from shot 1 |
| 24 | `CUTOFF_NOT_AT_END` | `speech.ts` | `<cutoff>` tag not on final beat | `cutoffBaker` | Add `<cutoff>` to shot 0 beat |
| 25 | `VISIBLE_TEXT_NOT_QUOTED` | `speech.ts` | On-screen text not in English double quotes | `visibleTextBaker` | Strip double quotes from `"OPEN"` |
| 26 | `SLOT_CEILING_EXCEEDED` | `sections.ts` | Media count exceeds ceiling (9 img, 3 vid, 3 aud) | `ref2vaCoffeeShop` | Add 8 extra image slots |
| 27 | `SLOT_NO_ROLES` | `sections.ts` | Slot has empty `roles` array | `ref2vaCoffeeShop` | `d.slots[0].roles = []` |
| 28 | `SLOT_ORDER_NOT_CONTIGUOUS` | `sections.ts` | Slot `order` indices not contiguous $0..N-1$ | `ref2vaCoffeeShop` | `d.slots[2].order = 99` |
| 29 | `REF_MISSING_SUMMARY` | `sections.ts` | Ref2VA `summary` is empty or whitespace | `ref2vaCoffeeShop` | `d.summary = ''` |
| 30 | `REF_MISSING_TASK_TYPES` | `sections.ts` | Ref2VA `taskTypes` array is empty | `ref2vaCoffeeShop` | `d.taskTypes = []` |
| 31 | `REF_TASK_TYPE_DUPLICATE` | `sections.ts` | Ref2VA `taskTypes` contains duplicate types | `ref2vaCoffeeShop` | Duplicate `'reference generation'` |
| 32 | `REF_SUMMARY_NEW_LABEL` | `sections.ts` | Summary cites undefined label | `ref2vaCoffeeShop` | Add `'<Picture 9>'` to summary |
| 33 | `REF_RETENTION_MISSING` | `sections.ts` | Subject or standalone slot missing retention | `ref2vaCoffeeShop` | `d.retention = []` |
| 34 | `REF_RETENTION_MARKER_WRONG_CLASS` | `sections.ts` | Audio marker on visual label or vice versa | `ref2vaCoffeeShop` | Visual marker `'fully_preserved'` on Audio |
| 35 | `REF_SPEAKER_IN_RETENTION` | `sections.ts` | Speaker ID `(S1)` written in retention | `ref2vaCoffeeShop` | Add `'(S1)'` to retention note |
| 36 | `REF_LABEL_UNDEFINED` | `sections.ts` | Beat prose cites undefined label | `ref2vaCoffeeShop` | Add `'<Subject 9>'` to beat prose |

*(Engine-Level Catch: `RULE_THREW` is emitted by `validate()` if an unexpected runtime exception escapes from any rule function).*

---

## 4. Test Discipline & Meta-Test Verification (`test/validate.test.ts`)

The validation test suite enforces two architectural testing disciplines:

### 4.1 Automated Build Gate Meta-Test
In `test/validate.test.ts` (lines 339–362), an automated meta-test scans all rule source files in `src/core/validate/rules/`:
```typescript
const emitted = new Set<string>();
for (const file of ruleFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\b(?:error|warn)\(\s*['"]([A-Z0-9_]+)['"]/g)) {
    emitted.add(match[1]);
  }
}

it('every emitted diagnostic code has a red control', () => {
  const controlled = new Set(CONTROLS.map((c) => c.code));
  for (const code of emitted) {
    expect(controlled.has(code), `Code ${code} emitted in rules but has no control in CONTROLS`).toBe(true);
  }
});
```
If a developer adds a validation check without writing a red-proving test fixture, the test suite fails immediately.

### 4.2 Cry-Wolf Protection via `Control.inspects`
The `inspects` property guards against hollow green tests. Four specific features (`crossesCut`, `cutoff`, `voiceover`, and `visibleText`) are represented by specialized base fixtures in `test/fixtures/exercised.ts`:
1. **`voiceoverBaker`**: Exercises off-screen voiceover phrasing.
2. **`visibleTextBaker`**: Exercises quoted on-screen text.
3. **`crossCutBaker`**: Exercises split dialogue crossing cut boundaries with `<scenetrans>`.
4. **`cutoffBaker`**: Exercises speech truncated at video end with `<cutoff>`.

---

## 5. Related Articles

- **[Master Index](index.md)**: Master knowledge base.
- **[Invariants & Hard Engineering Rules](invariants.md)**: Foundational invariants and purity rules.
- **[Intermediate Representation](core_ir.md)**: Document schemas and closed vocabularies.
- **[Prompt Serialization](core_serialize.md)**: Output prompt construction and source maps.
