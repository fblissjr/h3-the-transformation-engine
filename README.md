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

Nearly all of that is machine-checkable, so it is checked in code rather than asked for in a prompt.

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
  validate/      36 rules, all hard errors, each with a fixture that makes it go red
  serialize/     source-mapped emitter, both output contracts
  patch/         path-scoped patch application
src/provider/    Gemini Interactions client and the planner/patch prompts
src/crypto/      at-rest storage for the API key, three modes
src/db/          IndexedDB, three stores, immutable version tree, erase-and-verify
src/ui/          slot manager, document editor, prompt view, diagnostics, history, local data
```

`src/core` is runnable with no browser and no API key. That is what makes the grammar assertions cheap to run and lets the compiler move to a CLI or a ComfyUI-adjacent script later.

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
bun run test        # 176 tests
bun run typecheck
bun run build
bun run probe       # live API probes (reads GEMINI_API_KEY from .env)
```

`.env` is only for the probe script. The app never reads it — you paste your key into the UI.

## Verification

- Five golden fixtures reproduce the worked examples from both official guides **byte for byte**, and all five validate with zero errors.
- Every one of the 36 diagnostic codes has a control fixture that makes it fire, plus the standing evidence that the unbroken examples produce none of them.
- A meta-test scans the rule sources and fails if any emitted code has no control, so a new rule cannot ship without one. That meta-test has itself been shown to go red.
- A purity test fails if `src/core` imports React, the SDK, the DB layer, the DOM, or `fetch`.
- The request properties described in [Under the hood](#under-the-hood) — `store: false`, no `temperature`, an explicit `thinking_level` — are asserted in `test/provider.test.ts`.
- The storage claims are tested against `fake-indexeddb` rather than a mock, so rows are really written and databases really deleted. `test/wipe.test.ts` pairs every "it is gone" with a case where it is not, and `test/secureStore.test.ts` checks that the wrapping key refuses to export and that destroying it leaves the ciphertext in place but unreadable.
- The unexportable-key behaviour was then checked in Chrome directly: a `CryptoKey` generated with `extractable: false`, put through IndexedDB and read back, is a genuine structured clone rather than the same object, keeps `extractable: false`, still decrypts, and rejects `exportKey('raw')`, `exportKey('jwk')` and `wrapKey` with `InvalidAccessError`. **One browser, one machine.** Firefox and Safari are unverified.
- The schema repair was checked in Chrome against a hand-wedged database: version 1, `settings` store absent, both indexes absent, one document and three versions present. Loading the app bumped it to version 2, created the missing store and indexes, and left every row intact including the embedded reference image, with both index queries working afterwards. The key vault's repair was verified the same way, on a vault genuinely broken by a stray `indexedDB.open` during testing.

Two bugs in this area passed the whole unit suite and broke the running app anyway — a caller still requesting the retired key mode, and a key vault wedged at version 1 with no object store. Both were found by opening the app and clicking the button. Treat the tests as necessary and not sufficient.

**Errors only — there is no warning severity.** A diagnostic means the document is provably malformed: a cut outside the video, an undeclared speaker, a retention marker from the wrong vocabulary. Checks that pattern-matched prose for a preference — sentence counts, word targets, whether a camera annotation was echoed in the wording — were removed, because they fired on legitimate output. A check that cries wolf trains you to ignore the ones that matter. That guidance lives in the planner prompt instead, where being wrong costs nothing.

## Not built yet

- Video and audio reference analysis. Those need a Files API upload, PROCESSING polling and 48h handle expiry, and only the `uri` path is verified working. Those slots take a written description for now.
- Planner prompt tuning against real H3 generations. Everything verified so far is grammar; whether the prose conditions H3 well is unmeasured.
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
