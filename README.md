# H3 Transformation Engine

A prompt compiler and structured editor for MiniMax H3. It turns prompts into data: the saved artifact is a document, and the H3 prompt text is a pure function of it.

Prompt-only. Nothing here generates video.

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

H3 conditions on descriptive quality, and a canned camera clause bolted onto a sentence is exactly the "detached command stack" the official guide tells you to avoid. So a camera motion is stored both as prose and as `{type, amplitude, speed}`, and the validator asserts the two agree. Change the annotation without changing the prose and you get `CAMERA_PROSE_MISSING`.

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

Verified against `@google/genai` 2.17.1 types or probed live, not read from docs:

- `temperature` is accepted and silently ignored. Never sent; there is no temperature control.
- Thinking runs by default and bills at the output rate, so an unset `thinking_level` is the expensive path. Every call states one: `medium` to plan, `low` to patch.
- **`minimal` is not a valid thinking level for gemini-3.7-flash** (400; allowed are `high`, `low`, `medium`). The SDK type lists it because that union spans every model. `low` is the floor here, and `ThinkingLevel` is narrowed so the rejected value is unrepresentable.
- Browser-origin calls to `https://generativelanguage.googleapis.com/v1beta/interactions` are **allowed by CORS** — probed from a page, which read a 400 body directly. No dev proxy, no production relay.
- `system_instruction` and `generation_config` are interaction-scoped. Omitting them on a follow-up runs with neither, so both go on every call.
- `interactions.delete` returns 501, so a stored interaction cannot be purged. `store` is hard-wired `false`, which also rules out `previous_interaction_id` chaining — every call is standalone and carries the document as its context.
- `status: "incomplete"` means truncated at `max_output_tokens`. Terminal, distinct from failure, and the likeliest failure mode for a JSON planner. It raises a typed error carrying the partial text.

## Storage

The API key is stored in `localStorage` under AES-GCM. Two key modes, named honestly:

- `device` (default) derives the key from the user agent and locale. That is **obfuscation, not confidentiality** — anyone with the same browser build and locale can derive it.
- `passphrase` derives from a user secret and gives real confidentiality at rest.

Neither protects against script running in the page.

## Commands

```
bun install
bun run dev         # http://localhost:5173
bun test            # 131 tests
bun run typecheck
bun run build
bun run probe       # live API probes (reads GEMINI_API_KEY from .env)
```

## Verification

- Five golden fixtures reproduce the worked examples from both official guides **byte for byte**, and all five validate with zero errors.
- Every one of the 36 diagnostic codes has a control fixture that makes it fire, plus the standing evidence that the unbroken examples produce none of them.
- A meta-test scans the rule sources and fails if any emitted code has no control, so a new rule cannot ship without one. That meta-test has itself been shown to go red.
- A purity test fails if `src/core` imports React, the SDK, the DB layer, the DOM, or `fetch`.

**Errors only — there is no warning severity.** A diagnostic means the document is provably malformed: a cut outside the video, an undeclared speaker, a retention marker from the wrong vocabulary. Checks that pattern-matched prose for a preference — sentence counts, word targets, whether a camera annotation was echoed in the wording — were removed, because they fired on legitimate output. A check that cries wolf trains you to ignore the ones that matter. That guidance lives in the planner prompt instead, where being wrong costs nothing.

## Not built yet

- Video and audio reference analysis. Those need a Files API upload, PROCESSING polling and 48h handle expiry, and only the `uri` path is verified working. Those slots take a written description for now.
- Planner prompt tuning against real H3 generations.
- Visual design.
