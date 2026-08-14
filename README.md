# H3 Transformation Engine

A prompt compiler and structured editor for MiniMax H3. It turns prompts into data: the saved artifact is a document, and the H3 prompt text is a pure function of it.

Prompt-only. Nothing here generates video.

## Security and privacy

Read this before running it, and before deploying it anywhere.

**You supply your own API key.** There is no account, no backend, and no server owned by this project. The key you paste goes into your browser's `localStorage` and is sent, in an `x-goog-api-key` header, only to Google's Gemini endpoint. Verified on the wire: the key never appears in a URL, so it cannot leak through browser history, referrer headers, or a server access log.

**Nothing is logged.** There are zero `console.*` calls in `src/`. No analytics, no telemetry, no error reporting service, no outbound host other than the Gemini endpoint.

**Interactions are never stored server-side.** Every request sends `store: false`, and there is no setting to change it. This is a guarantee rather than a default: `interactions.delete` returns 501, so anything stored is retained for the full project retention window and can never be purged. `test/provider.test.ts` fails the build if that flag is ever anything but `false`, and it has been shown to go red when flipped.

**A Content-Security-Policy constrains where the page can talk.** `index.html` sets `connect-src 'self' https://generativelanguage.googleapis.com`, so a compromised dependency cannot POST your key to an attacker's host — the browser refuses the connection. `script-src 'self'` blocks injected inline script. Verified in a real browser: a fetch to an unrelated origin is refused while the Gemini endpoint stays reachable.

### What this does not protect against

**Key storage is weak by default, and the app says so.** The `device` mode derives its AES key from `navigator.userAgent + navigator.language`. That is **obfuscation, not confidentiality** — anyone with the same browser build and locale can derive the same key and read the blob. It stops a casual glance at `localStorage` and nothing more. Choose the `passphrase` mode for real confidentiality at rest.

Neither mode protects against script executing in the page. The CSP narrows where a compromise could send data, but anything running in this origin can read a decrypted key in memory.

**If you host this publicly**, every visitor supplies their own key and keys are never shared — but you are then responsible for the integrity of what you serve. Pin your dependencies and check them.

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
src/db/          IndexedDB, five stores, immutable version tree
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
- The privacy-critical request properties above are asserted in `test/provider.test.ts`.

**Errors only — there is no warning severity.** A diagnostic means the document is provably malformed: a cut outside the video, an undeclared speaker, a retention marker from the wrong vocabulary. Checks that pattern-matched prose for a preference — sentence counts, word targets, whether a camera annotation was echoed in the wording — were removed, because they fired on legitimate output. A check that cries wolf trains you to ignore the ones that matter. That guidance lives in the planner prompt instead, where being wrong costs nothing.

## Not built yet

- Video and audio reference analysis. Those need a Files API upload, PROCESSING polling and 48h handle expiry, and only the `uri` path is verified working. Those slots take a written description for now.
- Planner prompt tuning against real H3 generations. Everything verified so far is grammar; whether the prose conditions H3 well is unmeasured.
- Visual design.

## License

MIT. See [LICENSE](./LICENSE).
