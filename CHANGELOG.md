# Changelog

All notable changes to this project are documented here. Semantic versioning.

## [Unreleased]

### Added

- **Glitch marks.** A second, independent contribution on the creative record: up to three ultra-rare tokenizer strings — the `SolidGoldMagikarp` family and its relatives — placed in the scene as visible text on surfaces that differ from each other, one appearance each. Ten tokens, six surfaces, and a register switch that decides whether the marks are the only anomaly or whether the surrounding prose also reaches for the less expected material and light while staying inside what a camera can record. Two tokens carry a documented pull of their own; they are offered and never drawn at random. Three named presets and a draw button. Ported from the Sora 2 dual-stage architect's Glitch Token Infusion Edition and its standalone rewriter sibling: what came over is the placement grammar and the safety rules, not the worked examples, which are built out of timecodes and lens metrics that here are computed by code or absent from the vocabulary.
- **The marks know which pictures are actual frames.** What is forbidden everywhere — a mark in the style clause, a subject description or a retention note — is part of the derived block both prompts share. What is merely allowed is appended by the planner alone, because only it knows the mode: under I2VA, FL2VA and L2VA a mark may not be described as visible in a supplied frame, and under Ref2VA the marks stay on the environment and out of subject definitions, retention notes and the summary. A mark is on-screen text, so it goes through the contract's existing rule for that rather than a new one.
- **Record-level derivations.** `hasDirection`, `sameRecord`, `describeRecord` and `pruneRecord` read both halves of a creative record. The selection-only versions remain, and using one where the record is meant is now the specific mistake the new hard rule names: gating generation on the style alone drops a marks-only record before it reaches the document, and comparing the style alone leaves the badge reporting no change when the marks changed.
- **`test/creative.test.ts` and `test/creative-integration.test.ts` cover the marks end to end**: the derivation is total over ids it does not have, an empty token list is the same state as no record, the ceiling holds however many are stored, the drawable pool excludes the skewed tokens, both prompts derive identical text from one record, the planner appends a different note per mode and the patch prompt appends none, and a record with marks round-trips through the stored-document schema. Sixteen deliberate breakages were used to confirm the checks go red for the right reason, among them: dropping the `glitch` key from the schema, where an object schema strips what it does not describe and the round trip is the only thing that notices; the planner never emitting the block; the patch prompt ignoring the document's marks; one mode note used for all five; the ceiling unenforced; unknown ids resolving instead of being dropped; a skewed token in the draw pool; `sameRecord` and `hasDirection` reading the style half only; and restoring a record written before marks existed as one carrying an empty set.

- **Creative modes.** A style direction injected into the planner prompt, in four families that combine — visual medium, motion behavior, finish, audio treatment — plus a strength level that states how far the direction reaches. Four ways in: directed, fifteen named presets, a random wild draw, and off. The wild draw is restricted to combinations that score on at least three of five leverage axes with geometry or shape among them, because texture and cadence alone collapse back to H3's photorealism default.
- **Reference anchors are reachable.** All 30 are now offered in the visual picker alongside the 24 medium packs, under their own group. Previously exactly one was reachable, through a single preset.
- **`test/creative-integration.test.ts`**, covering the wiring the feature never had: that the planner prompt carries the direction and omits it when there is none, that the patch prompt derives the same text from the same record, that a creative mode survives a patch, that it changes nothing in the serialized prompt, and that a selection round-trips through the stored-document schema to the same prompt text. Seven deliberate breakages were used to confirm the checks go red for the right reason: dropping the style block from the planner, ignoring the document's style in the patch prompt, resolving unknown pack ids into text instead of skipping them, never reporting a schema failure, gating on one instead of reporting it, a patch that drops fields it does not recognise, and a pack stripped of its axes.


- **Erase local data**, as a `local data` button in the header. Two scopes: the workspace, its version history and settings; or that plus every stored secret and the wrapping key. The panel lists what is stored before you press anything and, afterwards, before-and-after counts re-read from storage — it can report that something is still there, including a delete blocked by another open tab, and turns red when it does. `closeDb()` before deleting is load-bearing: an open connection blocks `deleteDatabase` indefinitely, and removing that line leaves the wipe reporting success having removed nothing.
- **`origin` key mode, now the default for storing the API key.** A random AES-GCM-256 key generated with `extractable: false` and kept as a `CryptoKey` in IndexedDB `H3KeyVault`. Its bytes never exist in JavaScript, so a copied `localStorage` blob cannot be opened on another browser or machine. It does not protect against anyone using this browser profile, or against script on this origin, and the README says so. `passphrase` mode is unchanged and remains the only mode that does not depend on the machine.
- **`test/db.test.ts`**, covering a fresh database and three broken ones: empty at version 1, missing a single store, and stores present with no indexes.
- **`test/wipe.test.ts` and `test/secureStore.test.ts`**, run against `fake-indexeddb` so deletes and round-trips are real. Every "it is gone" assertion is paired with a case where it is not. Four deliberate breakages were used to confirm the checks go red for the right reason: dropping `closeDb()`, minting a replacement wrapping key on a failed read, hardcoding the secret name instead of scanning by prefix, and making `isClean` always return true.

### Changed

- **A creative selection travels; its directive text does not.** `CompileInput.style`, which carried a resolved envelope of prompt text plus the inputs that produced it through eight files, is now `CompileInput.creativeMode` carrying only the mode and the pack ids. The planner and patch prompts each derive the directive themselves, from the same record through the same function. Before, one path was handed pre-resolved text and the other built a different shape by hand, which is how the two would have drifted apart.
- **The pack tables are the single source for their family.** Ids, names, directives and strength axes now come out of one array per family, with the id union derived from the data the way `vocab.ts` does it. Adding a pack was a three-place edit across two files; it is now one place, and a pack cannot exist without a score.
- **Reference anchors have string ids (`R01`-`R30`) and share one id space with the packs.** The `string | number` union behind them was the sole cause of three separate branches — a `typeof` fork in the scorer, a `z.union` in the schema, and two-branch handling in the resolver. A stored document naming an anchor by its old number resolves to no style rather than failing to open.
- **The creative picker holds no state of its own.** The selection lives in `useEngine` and the panel is driven by it. Checked in a browser against a seeded document: the four dropdowns come back with the stored selection, and changing one preserves the other three.
- **The module exports only what something calls.** `wildPresets` and `getPreset` were defined, exported and — in the first case — tested, with no caller anywhere; `getAnchor` and `getVisualPack` were superseded by the single `getVisual` lookup the moment packs and anchors shared an id space; `activeAxes` is used only by the rule beside it and is no longer exported. Four are gone; the fifth stopped being public. This is the same shape as the dead schema fixed below, found by looking for it after.
- **The picker says when it describes the next generation rather than the open document.** The two carry different facts — what the next generate will use, and what the current prose was written under, which is what an assisted edit preserves. Changing the picker without regenerating left the badge and the patch prompt saying different things with nothing to indicate it.
- **A restored selection drops pack ids this build no longer has.** `pruneSelection` runs where a stored record enters the UI. The derivations already skipped an unresolvable id, but left in the selection it rendered as a blank dropdown and rode along through every later edit without ever being visible.
- **Strength is a scope, not a volume knob.** Each level states its own authority over the request, and the core planner instruction defers to the section rather than claiming a blanket override — `subtle` previously said to keep the treatment grounded while the core prompt said the direction overrode the request, in the same prompt.


- **`device` key mode is decrypt-only.** It derived the AES key from `navigator.userAgent + navigator.language`, which is public. Existing envelopes still open, so nobody loses a stored key, and the next save upgrades them to `origin`. A stored key that cannot be decrypted at all is now cleared rather than left in place claiming a key exists that will never open.
- **`DB_VERSION` removed.** Nothing read it once the schema, rather than the version number, became the test for what exists. Keeping an exported constant that no longer governs anything invites someone to open at it.
- **`fake-indexeddb` is a devDependency again.** It was dropped in 0.3.0 as unused; the storage tests need a real IndexedDB implementation rather than a mock. Dev-only, so the five packages reaching the bundle are unchanged.
- **README and CLAUDE.md both state what this is**: one person tinkering, no roadmap, no support, no reviewers, possibly no users.
- **Security section rewritten.** It is now a short statement of what is stored, where, and what leaves the machine, and says plainly that this is a personal-tool posture and wrong for anything shared. Detail moved to a new **Under the hood** section at the end, which states the sample size of its own checks: one browser, one machine, by hand.
- **Claims cut back to what the evidence supports.** "Interactions are never stored server-side" conflated `store: false` with Google-side retention generally; the flag opts out of Interactions conversation-state storage and nothing more, while abuse-monitoring logging and free-tier product-improvement terms apply regardless. Dependencies are now described as trusted rather than audited.
- **Layout section said the database has five stores.** It has three: `documents`, `versions`, `settings`.

### Fixed

- **A restored directed selection was invisible and the first change destroyed it.** The picker held the four pack choices in its own state, initialised empty. After a reload the badge showed the stored style but every dropdown was blank, and changing any one of them read the empty local copy, found no visual medium, and silently cleared the style. Presets and wild rehydrated correctly, which is what made it easy to miss. The panel is now driven entirely by the record passed in, so there is one copy rather than two.
- **A document written with a reference anchor selected would not parse.** Anchors moving to string ids narrowed the stored `visual` field to a string, and every document carrying the old numeric form then failed the new schema check, showed a notice on every load, and had its style silently dropped. `getVisual` now understands both forms and `pruneSelection` rewrites the old one, so such a document opens clean and comes back with its anchor. This is precisely the tightening the rule added in the same change forbids; it was caught by review, and the control that would have caught it is now in `test/creative-integration.test.ts`.
- **A schema notice could bury the notice saying the stored API key was gone.** Both are set in the same effect and the second overwrote the first, so a browser that failed to decrypt the key and failed to parse the document reported only the document. They are concatenated now.
- **`H3DocumentSchema` was dead code.** It was defined, exported, maintained, and imported nowhere, so nothing validated a stored document and the round-trip safety it was described as providing did not exist. It is now checked at the load boundary and reports rather than gates: a document that fails to parse is still opened, with the offending path surfaced as a notice, because a build that refuses to open what the previous build wrote loses work that exists nowhere else. Confirmed in a browser as well as in tests — a hand-damaged document opens, keeps its shots and its creative mode, and names its own defect.


- **The same wedge in the document database.** `H3TransformationEngine` opened at a hardcoded version 1 with unconditional `createObjectStore`, so a database that already existed at version 1 without its stores never got them and every call threw `NotFoundError`. It now opens without naming a version and treats the stores *and their indexes* as the test — a `versions` store missing its `documentId` index breaks the history view exactly as silently as a missing store. Repair creates only what is absent, so existing rows survive; `test/db.test.ts` asserts that rather than assuming it. Three controls confirmed the tests go red: restoring the fixed-version open, dropping the index check, and removing the create guards. Also checked in Chrome against a hand-wedged database carrying real rows — repaired to version 2 with nothing lost.
- **A key vault stuck at version 1 with no object store could never be repaired.** `openDB(name, 1, ...)` skips `upgrade` when the database is already at version 1, so every later call threw `NotFoundError` and the app could not store a key again, silently. Anything else on the origin calling `indexedDB.open('H3KeyVault')` creates exactly that database; it happened by accident during testing. The vault is now opened without naming a version, with the presence of the object store — not the version number — as the test, bumping only when it is missing. The first attempted fix hardcoded version 1 on reopen and failed the other way with `VersionError`; the regression test caught it.
- **Saving an API key without a passphrase threw and the failure was invisible.** `useEngine` still asked for the retired `device` mode, which `setSecret` had started rejecting, and `saveApiKey` did not catch it, so the form looked like it had saved. The whole unit suite passed while this was broken. `WritableKeyMode` now excludes `device` so `tsc` rejects it at build time, the runtime throw stays as a backstop for untyped callers, and a storage failure is reported in the UI.

- **`connect-src` no longer lists bare `ws:`/`wss:`.** Those are scheme-wide sources matching any host, so they left a compromised dependency a socket to anywhere — the exfiltration route the rest of the policy exists to close. They were there for the Vite hot-reload socket, which `'self'` already covers. Probed both ways against the real policy: before, a `fetch` to an unrelated origin was refused while a `WebSocket` to that same origin went through; after, both are refused, the Gemini endpoint stays reachable, and dev HMR still connects.
- **`frame-ancestors` removed from the `<meta>` CSP.** The directive is ignored there, so it was never doing anything. Noted in the README as needing a response header.

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
