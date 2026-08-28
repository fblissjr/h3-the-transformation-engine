# H3 Transformation Engine

A prompt compiler and structured editor for MiniMax H3. It turns prompts into data: the saved artifact is a document, and the H3 prompt text is a pure function of it.

Prompt-only. Nothing here generates video.

This is one person tinkering. It is not a product, there is no roadmap, no support, and quite possibly no users — it is public because the code may as well be. Nothing here has been reviewed by anyone else. Treat it accordingly, and see [Security](#security) before you point it at anything you care about.

## Security

Everything runs in your browser. There is no account, no backend, and no server owned by this project.

- **Your API key** sits in `localStorage`, encrypted with AES-GCM. By default the encryption key is one the browser generates and will not hand back, so the stored blob cannot be opened on another browser or machine. It does not stop anyone using *this* browser profile, since the app has to be able to decrypt it. Passphrase mode covers that case.
- **Your documents and their version history** sit in IndexedDB, unencrypted. Browser storage is scoped to one origin in one browser profile on this machine, and there is no server, so what can read it is whatever can use this browser profile or run script on this origin.
- **Your prompts** go to Google's Gemini endpoint, and what Google keeps is governed by the terms attached to your key rather than by anything in this code. Free-tier terms permit Google to use prompts and responses to improve its products.
- **Erasing it** is the `local data` button in the header. Two scopes: documents and history, or that plus the stored key. It reports counts re-read from storage afterwards.

That shape suits a personal tool on a machine you control. It is the wrong shape for anything shared, multi-user, or public. If the contents of your prompts matter, use passphrase mode and a paid-tier key.

Specifics — storage keys, what `store: false` does and does not buy you, what the CSP covers — are in [Under the hood](#under-the-hood).

## Why it is shaped like a compiler

Sora 2 and Veo 3.1 have no formal output contract, so tools for them are prompt mixers — free-form schema keys, several output formats, string concatenation. H3 is different. It has:

- two output contracts (three fields for T2VA/I2VA/FL2VA/L2VA, six sections for Ref2VA)
- three alignment lines that are exact strings with two substitutions
- closed vocabularies for camera motion, retention markers, and task types
- derived label ordinals, numbered independently per media kind by connection order
- a speaker registry assigned by order of vocal events
- arithmetic: `frames / 24`, two-decimal durations, `MM:SS.mmm` cut times

Nearly all of that is machine-checkable, so it is checked in code rather than asked for in a prompt, and stated once in [a spec the tests enforce](#the-contract).

```
input -> normalize (TS) -> plan (one Gemini call) -> validate (TS) -> [patch] -> serialize (TS) -> prompt
```

## The design decision that matters most

**Beats carry prose; enums are validated annotations.**

The planner writes the actual sentences. The serializer only assembles structure around them — labels, timestamps, tags, section headers, alignment lines, ordering. It never expands an enum into a sentence.

H3 conditions on descriptive quality, and a canned camera clause bolted onto a sentence is exactly the "detached command stack" the official guide tells you to avoid.

## Layout

```
src/core/        pure TypeScript, no React, no DOM, no network (enforced by a test)
  ir/            document types, zod schemas, path addressing, the closed vocabularies
  normalize/     duration, label assignment, mode inference, budgets
  validate/      30 rules emitting 37 error codes, each with a fixture that makes it go red
  serialize/     source-mapped emitter, both output contracts
  patch/         path-scoped patch application
  creative/      style packs, anchors, strength scoring, presets, glitch marks
  wildcards/     {category} substitution on the idea, and the experiment matrix
src/provider/    Gemini Interactions client and the planner/patch prompts
src/crypto/      at-rest storage for the API key, three modes
src/db/          IndexedDB, three stores, immutable version tree, erase-and-verify
src/ui/          slot manager, document editor, prompt view, diagnostics, history, local data
reference/h3/    the two official guides, and contract.json — the machine-readable spec
```

`src/core` is runnable with no browser and no API key. That is what makes the grammar assertions cheap to run and lets the compiler move to a CLI or a ComfyUI-adjacent script later.

## The contract

The two official MiniMax guides are tracked in [reference/h3/](./reference/h3/), because the central claim here is that every value in `src/core/ir/vocab.ts` traces to a line in one of them, and a claim that cannot be checked from a clean checkout is not a claim.

Beside them, [contract.json](./reference/h3/contract.json) is the machine-readable statement of the format: per mode the alignment line, section order, layout, separators and where the style clause goes; the legal vocabulary with a guide citation per value; the ordered blocks of both system prompts and which are conditional; every diagnostic and why it is legitimate; and everything the compiler does that no guide asks for, so contract and house style are distinguishable at a glance.

It is written independently of the code rather than generated from it — a spec derived from the implementation agrees with the implementation by construction, and would catch nothing. `test/contract.test.ts` binds it in both directions: code that drifts from the spec fails, and a spec that misdescribes the code fails. The guide files are hashed there too, so a revision to either becomes a visible event rather than a silent change underneath the fixtures.

Adding a mode, a section, a vocabulary value, a prompt block or a diagnostic means putting it in the spec first, watching that test fail, then implementing it.

## Creative modes

A creative mode contributes exactly one thing to the pipeline: a selection of pack ids, which the planner prompt turns into a style direction block. Four families combine — visual medium, motion behavior, finish, audio treatment — plus a strength level that says how far the direction reaches, from setting the medium and finish alone up to governing every visual layer.

The visual family covers 24 medium packs and 30 reference anchors in one id space. The anchors translate cultural and studio references into their observable traits, so what reaches the model is craft language rather than a name to imitate.

Four ways in: off, directed (pick the packs), presets (fifteen named combinations), and wild (a random draw restricted to combinations with enough leverage to read as a style change rather than a filter). The leverage test is five axes — geometry, shape, palette, motion, texture — and a draw needs three of them with geometry or shape among them.

Two properties hold this in place. The selection is the only thing stored or passed around; the directive text and the display label are derived wherever they are needed, so no copy of them can disagree with the selection. And the serializer never sees any of it — a document with a creative mode and one without serialize identically, because the style lives in the prose the planner wrote, not in a clause the code bolted on.

The picker and an open document are deliberately allowed to differ. The picker is what the next generation will use; the document remembers what its own prose was written under, and an assisted edit preserves that rather than adopting whatever is currently selected. When the two diverge the badge says which one it is describing.

### Glitch marks

The second contribution a creative record can make, independent of the style. A glitch mark is one of a small set of ultra-rare tokenizer strings — the `SolidGoldMagikarp` family and its relatives — placed in the scene as visible text: carved into a wall, legible in a reflection, flickering on a screen inside the frame, stamped on a crate, etched at the scale of a serial number, or half-scratched away. The effect is a string that is legible and deliberate with no author and no explanation. Nobody in the scene reads one, points at one or reacts to one.

Up to three per clip, each placed once, on a different kind of surface. Two of the ten tokens carry a documented pull of their own and are offered but never drawn at random. A register switch decides whether the marks are the only anomaly or whether the surrounding prose also reaches for the less expected material, light and pairing — and in either case every sentence still describes something a camera could record.

A mark is on-screen text, so it goes through the contract's existing rule for that: quoted in the prose, listed in the beat's `visibleText`. Where a mark may go depends on the mode, and only the planner is told, because only it knows the mode: a supplied picture is an actual frame and does not contain a mark, so under I2VA, FL2VA and L2VA the marks live away from the frame the picture fixes. Under Ref2VA they stay on the environment and out of subject definitions, retention notes and the summary, since the references do not contain these strings and a note that mentions one is claiming they do.

None of this is a validator rule. A mark placed badly is a prose preference, and preferences belong in the planner prompt.

This is not the glitch-art aesthetic. VHS wobble and chroma bleed are finish packs and a different feature that happens to share the word.

## Wildcards

`{setting}` anywhere in the idea is a category name. Rolling draws a value for it, so one idea becomes many and the same idea rolled twice is two different clips. Twelve categories of content — subject, action, setting, time, weather, prop, complication, sound, material, creature, era, scale — 122 values in all, deliberately separate from the creative packs: those decide how a clip looks, these decide what is in it. `{prop:3random}` draws three distinct values; `{era:all}` takes the category in its own order.

The idea box keeps the template. Rolling derives the idea rather than overwriting it, so a second roll is still possible and the seed has something to be a seed of. Expansion happens on the way into `CompileInput` and nowhere later — a document assembled from unexpanded text would render a literal `{setting}` into the H3 prompt, and the prompt is a pure function of the document, so there is no downstream place to fix it. The roll travels on the document as `{template, seed}`, both halves or neither, so checking out a version puts the idea box back in the state that produced it.

A name no category matches stays in the text exactly as written, and is reported. The idea is your own sentence; deleting a word out of it because it looked like a category name is worse than leaving something you can see.

Every value is a concrete, observable fragment, and a test checks the whole library against the abstractions the planner prompt rejects by name. A wildcard carrying "melancholy" would hand the planner a word it has been told not to write, arriving inside the idea where the style direction cannot override it.

### The experiment matrix

Every combination of the values nominated per axis, as ideas, capped at 64 with the cap reported. Rolling asks for something else; this holds everything fixed but one axis, which is the only way a comparison between two prompts means anything — and whether the planner's prose conditions H3 well is the open question here.

A placeholder asking for several values at once is not an axis: it is a decision already made, so `{prop:3random}` is drawn once from the matrix seed and held identical across every cell. Without that the same sentence meant two different things depending on which button was pressed.

It stops at the text. Compiling one is a model call, so that decision stays with the person pressing generate.

## Recognisable people

A widely recognised person, living, dead or fictional, reaches the prompt as the role they are known for, the era, the dress, and the traits that identify them on sight — never the proper name. Naming one pulls the frame toward a likeness and away from the scene that was asked for; describing one leaves you in charge of the shot. It applies even when the request names someone: the name is what you asked for, the description is how it gets made.

Two things are exempt, because they are reproduced exactly as given either way: words inside a `dialogue` field, and on-screen text. If a character says a name, they say it.

In both the planner and the patch prompts, so an edit cannot introduce a name the prose was written to avoid. Neither official guide mentions public figures, so this is house style rather than contract, and there is no validator rule for it — deciding whether a description names a real person is exactly the prose pattern-matching that got seventeen rules removed.

## The source map

The serializer records a character range per document path. That buys three things:

- click any span of the rendered prompt, select the node that produced it
- diagnostics underline the exact offending characters
- version diffs are per-node rather than per-line

## Editing

| Kind | Trigger | Model |
|---|---|---|
| Direct | typed field, enum dropdown | none |
| Surgical | select a node, give an instruction | one call, patch scoped to that path |
| Wide | select many nodes, one instruction | same shape, more paths |

All three go through the same gate. A patch names paths and values; it never returns a rewritten document. Three things are refused: paths outside the allowlist (derived values stay derived), paths that do not resolve (no auto-creation), and dialogue the user supplied (its whole value is coming through unchanged). Rejections are reported, never dropped.

Every applied edit creates an immutable version with a parent pointer and the operation list. Checking out an older version and editing branches rather than overwrites.

## Provider notes

Verified against `@google/genai` types or probed live, not read from docs:

- `temperature` is accepted and silently ignored. Never sent; there is no temperature control.
- Thinking runs by default and bills at the output rate, so an unset `thinking_level` is the expensive path. Every call states one: `medium` to plan, `low` to patch.
- **`minimal` is not a valid thinking level for gemini-3.7-flash** (400; allowed are `high`, `low`, `medium`). The SDK type lists it because that union spans every model. `low` is the floor here, and `ThinkingLevel` is narrowed so the rejected value is unrepresentable.
- Browser-origin calls to the Interactions endpoint are **allowed by CORS** — probed from a page, which read a 400 body directly. No dev proxy, no production relay.
- `system_instruction` and `generation_config` are interaction-scoped. Omitting them on a follow-up runs with neither, so both go on every call.
- `status: "incomplete"` means truncated at `max_output_tokens`. Terminal, distinct from failure, and the likeliest failure mode for a JSON planner. It raises a typed error carrying the partial text.

## Commands

```
bun install
bun run dev         # http://localhost:5173
bun run test        # 433 tests
bun run typecheck
bun run build
bun run probe       # live API probes (reads GEMINI_API_KEY from .env)
```

`.env` is only for the probe script. The app never reads it — you paste your key into the UI.

## Verification

- Five golden fixtures reproduce the worked examples from both official guides **byte for byte**, and all five validate with zero errors.
- Those fixtures are checked against the guide files themselves rather than trusted. Two of the five were not the guides' text: `T2VA` and `Ref2VA` had been transcribed with typographic apostrophes where the official text has ASCII ones, so every byte-exact test passed against a copy that was already wrong. `test/guide-fidelity.test.ts` compares the golden text to the tracked guides, and separately checks the character set, which is the half that needs no guide on disk — the worked examples are pure ASCII apart from the em dash opening the FL2VA and L2VA alignment lines.
- `test/contract.test.ts` binds [contract.json](./reference/h3/contract.json) to the implementation in both directions — 80 assertions covering the guide hashes, every alignment template, section order and layout read off rendered output, every vocabulary list, both prompts' ordered blocks, and the diagnostic catalogue against the codes the rules actually emit. Twelve deliberate breakages, six in the code and four in the spec, confirmed each fires.
- Every one of the 37 diagnostic codes has a control fixture that makes it fire, plus the standing evidence that the unbroken examples produce none of them.
- A meta-test scans the rule sources and fails if any emitted code has no control, so a new rule cannot ship without one. That meta-test has itself been shown to go red.
- A purity test fails if `src/core` imports React, the SDK, the DB layer, the DOM, or `fetch`.
- The request properties described in [Under the hood](#under-the-hood) — `store: false`, no `temperature`, an explicit `thinking_level` — are asserted in `test/provider.test.ts`.
- The creative modes are checked at both ends: the derivations in `test/creative.test.ts`, and the wiring in `test/creative-integration.test.ts` — that both the planner and the patch prompt derive the same directive from the same record, that a creative mode survives a patch, that it changes nothing in the serialized prompt, and that a selection round-trips through the stored-document schema to the same prompt text. Ten deliberate breakages were used to confirm those go red for the right reason.
- The glitch marks add eighteen more, among them the one an object schema makes invisible: dropping the `glitch` key strips it on load with no issue raised anywhere, and only the storage round trip notices. The wildcards add ten, including a placeholder being deleted rather than left in place, a seed that never reaches the draw, and a mood word entering the library.
- The stored-document schema is checked on load and reports rather than gates. It is exercised against all five golden fixtures, so a drift between the schema and the type shows up as a failing test rather than as a document that will not open.
- The storage claims are tested against `fake-indexeddb` rather than a mock, so rows are really written and databases really deleted. `test/wipe.test.ts` pairs every "it is gone" with a case where it is not, and `test/secureStore.test.ts` checks that the wrapping key refuses to export and that destroying it leaves the ciphertext in place but unreadable.
- The unexportable-key behaviour was then checked in Chrome directly: a `CryptoKey` generated with `extractable: false`, put through IndexedDB and read back, is a genuine structured clone rather than the same object, keeps `extractable: false`, still decrypts, and rejects `exportKey('raw')`, `exportKey('jwk')` and `wrapKey` with `InvalidAccessError`. **One browser, one machine.** Firefox and Safari are unverified.
- The creative picker was checked in Chrome against seeded documents. The four dropdowns come back carrying the stored selection, and changing one preserves the other three. A reference anchor resolves through the same path as a medium pack. A selection naming a pack this build no longer has comes back with that one field cleared and the rest intact. A document written by the previous build, carrying a reference anchor in the numeric form that build used, opens with no schema complaint and its anchor intact. A hand-damaged document opens with its defect named rather than being refused. Switching the picker away from the style an open document was written under shows the caveat saying so, and clears it on switching back. **One browser, one machine.**
- The schema repair was checked in Chrome against a hand-wedged database: version 1, `settings` store absent, both indexes absent, one document and three versions present. Loading the app bumped it to version 2, created the missing store and indexes, and left every row intact including the embedded reference image, with both index queries working afterwards. The key vault's repair was verified the same way, on a vault genuinely broken by a stray `indexedDB.open` during testing.

Three bugs so far passed the whole unit suite and broke the running app anyway — a caller still requesting the retired key mode, a key vault wedged at version 1 with no object store, and a creative picker that showed a restored style in its badge but not in its controls, then destroyed it on the first change. All three were found by opening the app and clicking the thing. Treat the tests as necessary and not sufficient.

A fourth escaped even that. Tightening the stored `visual` field to a string broke only documents written by the *previous* build, and every check — the suite, the controls, the browser pass — ran against documents written by the current one, so nothing exercised it. An independent review of the diff caught it, along with the fact that it violated a rule written in the same diff. The lesson kept in [CLAUDE.md](./CLAUDE.md) is that reviewing your own change is the one gap none of the other checks close, and that the cheap standing test is to seed a document in the shape the last build wrote.

A fifth was in the tests themselves. The golden fixtures were described as byte-exact reproductions of the guides, and two of them were not — the byte-exactness was a claim nothing checked, so the suite compared the serializer to a transcription that had already drifted. Every check in this repo that says "verified" now has to name the thing it read.

**Errors only — there is no warning severity.** A diagnostic means the document is provably malformed: a cut outside the video, an undeclared speaker, a retention marker from the wrong vocabulary. Checks that pattern-matched prose for a preference — sentence counts, word targets, whether a camera annotation was echoed in the wording — were removed, because they fired on legitimate output. A check that cries wolf trains you to ignore the ones that matter. That guidance lives in the planner prompt instead, where being wrong costs nothing.

## Not built yet

- Video and audio reference analysis. Those need a Files API upload, PROCESSING polling and 48h handle expiry, and only the `uri` path is verified working. Those slots take a written description for now.
- Planner prompt tuning against real H3 generations. Everything verified so far is grammar; whether the prose conditions H3 well is unmeasured. The experiment matrix is the instrument for asking — it holds every variable but one fixed — but nothing has been run through it yet.
- Compiling a matrix in one go. It produces ideas; each still has to be generated by hand, because each is a model call.
- Visual design.

## Under the hood

What the code does:

- **Key at rest** — AES-GCM-256 in `localStorage` under `h3-secure:gemini-api-key`. Three modes, in `src/crypto/secureStore.ts`:
  - `origin`, the default. A random AES-GCM-256 key generated with `extractable: false`, kept as a `CryptoKey` in IndexedDB `H3KeyVault`. `exportKey` on it rejects, so its bytes never exist in JavaScript and the ciphertext can only be opened from this origin in this browser profile. The key is generated on your machine at first use; no key material is in this repo.
  - `passphrase`, PBKDF2-HMAC-SHA256 at 310,000 iterations over what you type. The only mode that does not depend on the machine.
  - `device`, legacy and decrypt-only. Derived from `navigator.userAgent + navigator.language`, which is not a secret; it was the old default. Existing values still open so nobody loses a stored key, writing it now throws, and the next save upgrades to `origin`.
- **Key in transit** — sent as an `x-goog-api-key` header, not in a URL, on every call this app makes. `generativelanguage.googleapis.com` is the only host it contacts.
- **Erasing local data** — `local data` in the header. `src/db/wipe.ts` closes the cached connection, deletes the databases, clears every `localStorage` key under the `h3-secure:` prefix, then re-opens storage and counts what is left. The panel shows those before-and-after counts and turns red if anything remains, including when another open tab blocks the delete.
- **No stored interactions** — `store: false` on every request, no setting to change it, enforced by `test/provider.test.ts`. Chosen because `interactions.delete` returns 501, so a stored interaction could not be removed later.
- **CSP** — `connect-src 'self' https://generativelanguage.googleapis.com`, `script-src 'self'`. Bare `ws:`/`wss:` are deliberately absent: they match any host, which would hand a compromised dependency a socket to anywhere. `frame-ancestors` is absent because it is ignored in a `<meta>` tag — set it as a response header if you deploy this.
- **No logging of its own** — zero `console.*` in `src/`, no analytics, telemetry, or error reporting.

What that does not cover:

- **`store: false` is not a retention guarantee.** It opts out of Interactions conversation-state storage. Google still logs prompts and responses for a period to enforce the Prohibited Use Policy, and free-tier terms permit using prompts and responses to improve its products. Zero data retention is a paid, approved-project posture. ([abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies), [terms](https://ai.google.dev/gemini-api/terms), [ZDR](https://ai.google.dev/gemini-api/docs/zdr)) Which tier issued your key matters more here than anything in this repo.
- **Nothing stops script running on this origin.** This is the ceiling, and no storage scheme moves it. Script on this origin can call `getSecret` exactly as the app does, or read the key out of memory once it is unlocked. `origin` mode makes a stolen `localStorage` dump useless on another machine; it does nothing about an attacker already executing here.
- **Documents are not encrypted.** IndexedDB `H3TransformationEngine`, stores `documents`, `versions`, `settings`, all in the clear. Anything with access to the browser profile can read them.
- **Give it its own origin if you host it.** Browser storage is partitioned by origin, not by path, so a deploy that shares a hostname with other pages shares this app's storage with them.
- **Erasing is local only.** It clears what this app wrote. Browser history, the disk cache, OS-level backups, and anything already sent to Google are all outside it.
- **Dependencies are trusted, not audited.** Five packages reach the bundle: `react`, `react-dom`, `zod`, `idb`, `@google/genai`. Nothing in the build points at a third-party host, but that describes the versions pinned in `bun.lock`, not a property anyone enforces.

**Test it yourself.** The above was checked by hand, in one browser, on one machine, by one person — a small sample, not a security audit. The CSP claims in particular take a few minutes to reproduce: serve a page carrying the same policy, listen for `securitypolicyviolation`, and try a `fetch` and a `WebSocket` at some host that is not on the list. Both should be refused, and the fetch case is what tells you the probe can go red at all. For the storage claims, open devtools, watch `localStorage` and both IndexedDB databases, and press the erase button.

## License

MIT. See [LICENSE](./LICENSE).
