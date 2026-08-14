# Changelog

All notable changes to this project are documented here. Semantic versioning.

## [Unreleased]

### Fixed

- **`connect-src` no longer lists bare `ws:`/`wss:`.** Those are scheme-wide sources matching any host, so they left a compromised dependency a socket to anywhere — the exfiltration route the rest of the policy exists to close. They were there for the Vite hot-reload socket, which `'self'` already covers. Probed both ways against the real policy: before, a `fetch` to an unrelated origin was refused while a `WebSocket` to that same origin went through; after, both are refused, the Gemini endpoint stays reachable, and dev HMR still connects.
- **`frame-ancestors` removed from the `<meta>` CSP.** The directive is ignored there, so it was never doing anything. Noted in the README as needing a response header.

### Changed

- **Security section rewritten.** It is now a short statement of what is stored, where, and what leaves the machine, and says plainly that this is a personal-tool posture and wrong for anything shared. Detail moved to a new **Under the hood** section at the end, which states the sample size of its own checks: one browser, one machine, by hand.
- **Claims cut back to what the evidence supports.** "Interactions are never stored server-side" conflated `store: false` with Google-side retention generally; the flag opts out of Interactions conversation-state storage and nothing more, while abuse-monitoring logging and free-tier product-improvement terms apply regardless. Dependencies are now described as trusted rather than audited.
- **Layout section said the database has five stores.** It has three: `documents`, `versions`, `settings`.

## [0.3.0]

Prepared for open source.

### Added

- **MIT license.**
- **Content-Security-Policy** in `index.html`. `connect-src` is limited to this origin and the Gemini endpoint, so a compromised dependency cannot exfiltrate the user's API key; `script-src 'self'` blocks injected inline script. Verified in a browser: a fetch to an unrelated origin is refused while the Gemini endpoint stays reachable.
- **`test/provider.test.ts`** — asserts the privacy-critical request properties the README promises: `store: false` (and that it cannot be overridden), no `temperature`, an explicit `thinking_level`, images inline rather than uploaded. `buildRequest` was extracted as a pure function so these need no key and no network.
- **`CLAUDE.md`** — the invariants and hard rules that govern changes.

### Changed

- **All dependencies to latest stable**, including three major bumps: TypeScript 5.8 → 7, Vite 6 → 8, Vitest 3 → 4, plus `@vitejs/plugin-react` 5 → 6. TS 7 removed `baseUrl` and requires relative `paths`; it also needs a `vite/client` reference for CSS side-effect imports. Build is faster and ~45 kB smaller.
- **Removed three unused dev dependencies**: `jsdom` and `fake-indexeddb` (tests run in the node environment) and `autoprefixer` (Tailwind v4 prefixes itself). Fewer dependencies is also a smaller supply-chain surface.
- README leads with security and privacy, and states plainly what the default key storage does *not* protect against.

### Verified before publishing

No secrets in the tree or in full git history, no `.env` ever committed, zero absolute paths or usernames in tracked files, no untracked files that `git add -A` would sweep in, no `console.*` in `src/`, and the API key travels in a header rather than a URL.

## [0.2.1]

### Changed

- **Validator is hard errors only; 53 rules → 36.** Seventeen checks were removed after firing on legitimate output: nine warnings and eight prose heuristics, including a 350-word target that flagged a 90-word description and a camera prose-echo check that flagged a static shot with no camera sentence — wrong by construction, since a static shot is the absence of motion. The warning severity is gone from `Diagnostic` entirely. None of the guidance was lost; it was already in the planner prompt, where being wrong costs nothing instead of training you to ignore the panel.

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
