# H3 Transformation Engine

A prompt compiler and structured editor for MiniMax H3. It turns prompts into data: the saved artifact is a document, and the H3 prompt text is a pure function of it.

Prompt-only. Nothing here generates video.

## Security

Everything runs in your browser. There is no account, no backend, and no server owned by this project. Here is all of it — what gets stored, where, and what leaves the machine:

- **Your API key** sits in `localStorage`, encrypted with AES-GCM. By default the encryption key is derived from your user agent and locale, which is obfuscation, not secrecy — anyone with the same browser and locale can undo it. There is a passphrase mode. Use it.
- **Your documents and their version history** sit in IndexedDB, unencrypted. Nothing clears them but you.
- **Your prompts** go to Google's Gemini endpoint, and what Google keeps is governed by the terms attached to your key rather than by anything in this code. Free-tier terms permit Google to use prompts and responses to improve its products.

That shape is fine for a personal tool on a machine you control. It is the wrong shape for anything shared, multi-user, or public. And if the contents of your prompts actually matter, you should harden it even for yourself — passphrase mode, a paid-tier key, and a read of the CSP notes below.

If you want the specifics — storage keys, what `store: false` does and does not buy you, what the CSP covers — see [Under the hood](#under-the-hood). If not, that is the whole story.

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
src/db/          IndexedDB, three stores, immutable version tree
src/ui/          slot manager, document editor, prompt view, diagnostics, history
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
bun test            # 142 tests
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

**Errors only — there is no warning severity.** A diagnostic means the document is provably malformed: a cut outside the video, an undeclared speaker, a retention marker from the wrong vocabulary. Checks that pattern-matched prose for a preference — sentence counts, word targets, whether a camera annotation was echoed in the wording — were removed, because they fired on legitimate output. A check that cries wolf trains you to ignore the ones that matter. That guidance lives in the planner prompt instead, where being wrong costs nothing.

## Not built yet

- Video and audio reference analysis. Those need a Files API upload, PROCESSING polling and 48h handle expiry, and only the `uri` path is verified working. Those slots take a written description for now.
- Planner prompt tuning against real H3 generations. Everything verified so far is grammar; whether the prose conditions H3 well is unmeasured.
- Visual design.

## Under the hood

Tried to follow best practices via:

- **Key at rest** — AES-GCM-256 in `localStorage` under `h3-secure:gemini-api-key`, key derived with PBKDF2-HMAC-SHA256 at 310,000 iterations. `passphrase` mode is real encryption. The default `device` mode derives from `navigator.userAgent + navigator.language`, which is not a secret, so it is obfuscation only.
- **Key in transit** — sent as an `x-goog-api-key` header, not in a URL, on every call this app makes. `generativelanguage.googleapis.com` is the only host it contacts.
- **No stored interactions** — `store: false` on every request, no setting to change it, enforced by `test/provider.test.ts`. Chosen because `interactions.delete` returns 501, so a stored interaction could not be removed later.
- **CSP** — `connect-src 'self' https://generativelanguage.googleapis.com`, `script-src 'self'`. Bare `ws:`/`wss:` are deliberately absent: they match any host, which would hand a compromised dependency a socket to anywhere. `frame-ancestors` is absent because it is ignored in a `<meta>` tag — set it as a response header if you deploy this.
- **No logging of its own** — zero `console.*` in `src/`, no analytics, telemetry, or error reporting.

What that does not cover:

- **`store: false` is not a retention guarantee.** It opts out of Interactions conversation-state storage. Google still logs prompts and responses for a period to enforce the Prohibited Use Policy, and free-tier terms permit using prompts and responses to improve its products. Zero data retention is a paid, approved-project posture. ([abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies), [terms](https://ai.google.dev/gemini-api/terms), [ZDR](https://ai.google.dev/gemini-api/docs/zdr)) Which tier issued your key matters more here than anything in this repo.
- **Documents are not encrypted.** IndexedDB `H3TransformationEngine`, stores `documents`, `versions`, `settings`, all in the clear.
- **Nothing stops script running on this origin.** Once decrypted, the key is in memory.
- **Dependencies are trusted, not audited.** Five packages reach the bundle: `react`, `react-dom`, `zod`, `idb`, `@google/genai`. Nothing in the build points at a third-party host, but that describes the versions pinned in `bun.lock`, not a property anyone enforces.

**Test it yourself.** The above was checked by hand, in one browser, on one machine — a small sample, not a security audit. The CSP claims in particular take a few minutes to reproduce: serve a page carrying the same policy, listen for `securitypolicyviolation`, and try a `fetch` and a `WebSocket` at some host that is not on the list. Both should be refused, and the fetch case is what tells you the probe can go red at all.

## License

MIT. See [LICENSE](./LICENSE).
