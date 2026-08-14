# Changelog

All notable changes to this project are documented here. Semantic versioning.

## [0.2.0]

### Added

- **API key entry with a passphrase option** (`src/ui/KeyPanel.tsx`). Three states, because a passphrase-protected key that exists but is not unlocked is not the same as no key: collapsing them prompted the user to paste their key again and overwrote a good stored one. Change and remove were also missing entirely — once set, the key was a one-way door.
- **`SUMMARY_VOCAL_DIRECTIVE`** validator rule. Naming a vocal act without supplying its words is an instruction to vocalise: an observed H3 render had a subject babble until she reached her scripted line, because the summary said she "speaks to the camera". Deliberately narrow — the guide's own summary describes actions, shot count and the ending, and stays green.
- **`REF_FRAME_ROLE_EXTENDED`** validator rule. A first-frame anchor whose retention note says its composition is "restored for the closing wide shot" silently becomes an ending requirement. Scoped to slots carrying exactly one frame-anchor role.

### Changed

- Planner prompt gains a `# Style` section (live action was the implicit default, reinforced by the schema's own example), an evidentiary rule for subject traits (a written trait is generated even when it contradicts the asset, and `fully_preserved` does not repair it), and the frame-anchor and speech-act constraints above.
- Patch prompt guards the same two failure modes, which a surgical edit can introduce.
- Schema `describe()` strings no longer few-shot the model toward live action.

### Notes

Several confident recommendations from the source transcript were **rejected**, each falsified by the golden fixtures: banning `<Picture N>`/`<Audio N>` citations inside the timeline (both guides do it), compressing retention notes (the guide repeats traits deliberately), omitting `(S1)` for a single speaker, and a bracketed FL2VA alignment line (the guide's is bare). A rule enforcing any of the first three would have turned a guide reproduction red.

## [0.1.0]

First working version: the compiler is complete for all five modes and there is an editor on top of it.

### Added

- **Document model** (`src/core/ir`). Types, zod schemas, path addressing, and the closed vocabularies from both official guides. Slots and subjects are separate registries with a many-to-many between them, because one subject may draw on several assets and one asset may supply several subjects.
- **Normalizer** (`src/core/normalize`). Duration arithmetic including the 17k+5 frame grid, reference label assignment, mode inference from slot roles, and shot/word budgets. Everything computable without a model is computed here and supplied to the planner as fact.
- **Validator** (`src/core/validate`). 51 rules across contract structure, duration, shot numbering and cut times, alignment strings, camera vocabulary, the speaker registry, dialogue and voiceover, cross-cut tags, visible text, the audio sections, Ref2VA labels and retention, and slot ceilings.
- **Source-mapped serializer** (`src/core/serialize`). Both output contracts, with a character range recorded per document path so the rendered prompt links back to the nodes that produced it.
- **Patch pipeline** (`src/core/patch`). Path-scoped edits behind three gates: an allowlist that keeps derived values derived, an existence check that refuses auto-creation, and a guard that makes user-supplied dialogue immutable.
- **Gemini Interactions client** (`src/provider`). One narrow call shape with the API's verified behaviour encoded: `store: false` always, `temperature` never sent, `thinking_level` and `system_instruction` on every call, and a five-way status branch that treats truncation as terminal and distinct from failure.
- **Planner and patch prompts** (`src/provider/prompts`). Shared core plus per-mode blocks, carrying only rules that need semantic judgment.
- **Storage** (`src/db`, `src/crypto`). Five IndexedDB stores and an immutable version tree with branching. API key storage offers a device-derived mode and a passphrase mode, named for what each actually provides.
- **Editor** (`src/ui`). Slot manager with role assignment and derived-label readout, document tree editor, rendered prompt with click-to-select and inline diagnostics, and branch history.

### Verified

- Five golden fixtures reproduce the worked examples from both official guides byte for byte, and all five validate with zero errors.
- Every diagnostic code has a control fixture that makes it fire; a meta-test fails the build if any emitted code lacks one, and that meta-test was itself proven able to go red.
- A purity test keeps `src/core` free of React, the SDK, the database layer, the DOM, and `fetch`.
- 161 tests, clean typecheck, clean production build.

### Notes

- Two API unknowns were settled from the installed SDK types rather than by guessing: `generation_config.thinking_level` is snake_case with values `minimal | low | medium | high`, and `response_format` is `{ type, mime_type, schema }`. Two remain for the live probe script: the model id form and browser CORS.
- Video and audio references are not sent for analysis. Those need a Files API upload with PROCESSING polling and 48h handles; the slots take a written description instead.
