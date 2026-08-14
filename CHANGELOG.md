# Changelog

All notable changes to this project are documented here. Semantic versioning.

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
