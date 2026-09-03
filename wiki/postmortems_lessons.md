# Consolidated Engineering Postmortems, Traps & Lessons Learned

[Back to Master Index](index.md) · [Invariants & Hard Rules](invariants.md) · [Architecture Guide](architecture.md) · [Validation Engine](core_validate.md) · [Provider Subsystem](provider.md) · [Database Lifecycle](db.md)

---

## 1. Executive Summary & Philosophy

The H3 Transformation Engine was developed through an empirical, test-driven methodology where every architectural invariant and rule was forged from concrete bugs, false-green testing hazards, and measured reality rather than deduction.

As stated in `CLAUDE.md`:
> *"One person tinkering. Not a product, no roadmap, no support, no reviewers, and possibly no users other than the owner. That is a licence to keep the code small and to delete things, not a licence to skip controls — the point of working this way is that nobody else is going to catch a mistake."*

This document consolidates all historical engineering lessons, traps, and false-green failure modes discovered across all four documented sessions in `postmortems/` (`2026-08-28`, `2026-08-30`, `2026-08-31`, `2026-09-01`) and the hard rules of `CLAUDE.md`.

---

## 2. The Core Engineering Disciplines

### 2.1 The Two Foundational Invariants

1. **Beats carry prose; enums are validated annotations:**
   The planner LLM writes the actual descriptive prose. The serializer (`src/core/serialize/`) assembles structural syntax around them (timestamps, ordinals, section headers, alignment lines) and never expands an enum into prose. MiniMax H3 conditions on natural visual description; bolting canned clauses onto sentences produces the "detached command stack" explicitly warned against in official guides.
2. **The prompt text is a pure function of the document:**
   `serialize(doc, ctx)` is total, pure, and deterministic. No manual or surgical patching of the emitted prompt string is permitted. Any manual edit to output text desynchronizes cut timestamps, alignment lines, and label ordinals. If prompt output must change, the underlying document AST (`H3Document`) must gain a field.

### 2.2 Testing Disciplines & The Breakage Imperative

- **Break a check where its green could be hollow:**
  Tests often pass for reasons unrelated to their subject (e.g., passing because execution never reached the assertion, or because another guard carried it). To prove that a test actually guards what it claims, introduce a deliberate breakage. If the test stays green, the test is blind.
- **A test that breaks whenever logic changes is a change detector, not a test:**
  A test should verify semantic properties, not incidental implementation details. Pinned prose assertions that fail on harmless wording improvements are brittle change detectors.
- **Assert the property directly; label proxies explicitly:**
  Where a property cannot be tested directly and a proxy must be used, state in the test that it is a proxy. Pinned enumerations are safe only when guarding against dangerous additions (allowlists), not when restricting safe evolution (denylists).
- **The Empty Grep / Negative Search Trap:**
  A search or test that returns null proves nothing unless proven capable of matching known existing artifacts. Searching for rendered output in raw prompt source templates (which contain `${...}` interpolation) or searching with trailing spaces inevitably produces false negatives that get recorded as false facts.
- **Checks narrower than their claims prove nothing:**
  Running a check whose scope is smaller than the conclusion drawn is an invisible trap (e.g., diff-scoped greps claiming repo-wide facts, or probing a server with mixed model architectures to infer process-wide serialization).
- **Maintenance vs. Construction:**
  A guarantee that holds because a human maintains a list is not a guarantee that holds by construction. For example, `VISION.md` claimed timestamps could not be edited because no path existed, whereas in reality `shots[].cutAtMs` exists in `PATCHABLE_LEAVES` and is maintained by convention.

---

## 3. Session 1 (2026-08-28): Glitch, Wildcards, and the H3 Contract

**Scope:** Glitch token infusion, wildcard library, experiment matrix, and machine-readable contract extraction (`reference/h3/contract.json`). Commits `ba179c0` through `a95ae8c`.

### Key Traps & Discoveries

1. **Typographic Apostrophe Drift in Golden Fixtures:**
   - *Trap:* The golden test fixtures in `src/core/ir/examples.ts` had silently drifted by 13 characters across T2VA and Ref2VA due to typographic curly apostrophes (`’`, U+2019) replacing ASCII straight apostrophes (`'`). Byte-exact tests passed because they compared serializer output to an already-corrupted copy.
   - *Fix:* `test/guide-fidelity.test.ts` was implemented to compare golden fixtures directly against the raw markdown guide files on disk, alongside a strict ASCII character-set validator enforcing that the em dash (`—`, U+2014) is the only legal non-ASCII character.
2. **Spec Self-Verification Fallacy:**
   - *Trap:* An audit of `contract.json` found ~40 defects in the spec itself (e.g., quoting Ref 5.2's 350–500 word range without noting that it applies strictly to generation tasks and exempts video editing).
   - *Lesson:* A test suite that compares code against a specification proves only that they agree; it cannot prove that both are not simultaneously wrong.
3. **The Creative Record Two-Halves Coupling Bug:**
   - *Trap:* Preserving glitch marks when pressing "Off" in `CreativePanel` required returning a record. Because a record required a mode, the handler returned `mode: 'directed'`. This lit up the Directed UI button, opened its panel, and made pressing Off a second time impossible.
   - *Fix:* Glitch marks were decoupled from style selection. The rule was established that a `CreativeModeRecord` has two independent halves, and all callers must inspect both using `withGlitch`, `hasDirection`, and `sameRecord`.
4. **Prototype Pollution in the Experiment Matrix:**
   - *Trap:* A template containing `{constructor}` bypassed category recognition, but cell substitution looked up `values['constructor']`, accessing `Object.prototype.constructor`. This stringified `"function Object() { [native code] }"` into every matrix cell. Because the string lacked braces, it bypassed the compile guard and spent real model calls.
   - *Fix:* `product()` in `src/core/wildcards/matrix.ts` was rewritten to use null-prototype objects (`Object.create(null)`), and `substitute()` checks `Object.prototype.hasOwnProperty`.
5. **Creative Mode Stamping Past the Model Call:**
   - *Trap:* Deleting creative mode stamping from `compile()` left ~400 tests green because the code sat past the model invocation where mock fixtures bypassed it.
   - *Fix:* Mode stamping and wildcard roll stamping were moved into `assemble()`, where unit tests directly exercise them.
6. **Hollow Greens in Validator Tests (`Control.inspects`):**
   - *Trap:* Four validator tests asserted that rules did not fire on known-good inputs, but the inputs lacked voiceover, on-screen text, lines crossing cuts, or speech cutoffs (`crossesCut: 0, cutoff: 0, voiceover: 0, visibleText: 0`).
   - *Fix:* `test/fixtures/exercised.ts` was created to provide realistic fixtures, and `Control.inspects` was added to `test/validate.test.ts` to ensure that base fixtures actually contain the syntactic features inspected by the rule.

---

## 4. Session 2 (2026-08-30): heylook Provider Integration

**Scope:** Integration of local Anthropic-compatible provider (`heylook`), image resizing, and `InferenceClient` abstraction. Commits `10ae5f2` through `f9f513f`.

### Key Traps & Discoveries

1. **The Cancellation Release Illusion:**
   - *Trap:* `README.md` and code comments asserted that clicking "Stop" told the server to abandon generation, releasing the GPU queue. When measured, aborting a 73.1s non-streaming generation after 5.0s left the next request waiting 57.9s (the remainder of the generation).
   - *Mechanism:* Non-streaming HTTP requests write nothing to the connection until completion; the server never learns that the client disconnected. (Streaming requests, by contrast, drop the connection immediately).
   - *Resolution:* Upstream heylook maintainers added `DELETE /v1/requests/{id}` keyed on `X-Request-ID`.
   - *Lesson:* A behavioural claim about third-party software is not documentation until it has been empirically measured.
2. **`InferenceClient` Seam Extraction:**
   - *Success:* `InferenceClient` (`src/provider/types.ts`) was extracted strictly from what caller `pipeline.ts` needed (one call method taking an options bag), not from provider features. `compile()` and `edit()` never branch on the active backend.
3. **Date Parsing Fallthrough in Retry-After:**
   - *Trap:* `retryAfterMs` in `src/provider/heylook/client.ts` handled non-numeric header values using `Date.parse()`. When heylook returned `Retry-After: -1` on overload, `Date.parse("-1")` parsed `-1` as the year 2001, resulting in a timestamp in the past and producing a 0-millisecond busy-loop against a saturated server.
   - *Fix:* Guarded against negative values and added exponential backoff fallbacks.
4. **First-Match vs. Target Extraction in `extractJsonObject`:**
   - *Trap:* When parsing unconstrained LLM responses, `extractJsonObject` initially matched the first parseable `{}` block. If the model included conversational preamble mentioning `{}`, the parser extracted the empty object instead of the payload.
   - *Fix:* Rewritten to scan candidate balanced JSON spans and select the candidate containing expected schema keys (`shots`, `beats`, or `patches`).
5. **Capabilities vs. Modalities Gating:**
   - *Trap:* Checkpoints served via MLX advertised vision in `modalities: ['text', 'vision']` while the server runtime stripped the vision tower, returning 400 on image inputs.
   - *Lesson:* Gating must check active runtime `capabilities` from `/v1/models` while still gracefully handling runtime 400 refusals.
6. **Prompt Asking Model for Schema Violations:**
   - *Trap:* An edit to `src/provider/prompts/planner.ts` instructed the model to leave `subjects[].sources` empty on certain jobs. However, `src/core/ir/schema.ts` enforced `z.array().min(1)` on sources, causing immediate validation rejections.

---

## 5. Session 3 (2026-08-31): Debug Console & Telemetry Sink

**Scope:** Bounded in-memory event bus (`src/debug/`), redaction, and `DebugConsole` UI. Commits `1badc1f` through `d69ba8d`.

### Key Traps & Discoveries

1. **The Shared-Tree Git Recovery Trap:**
   - *Trap:* When an accidental commit staged another concurrent agent session's work in `src/ui/useEngine.ts`, attempting to selectively unweave the lines wasted multiple round trips.
   - *Fix:* Executed `git reset --mixed HEAD~1`. This moved git HEAD back while leaving the working directory completely untouched.
   - *Lesson:* In a shared working tree, choose recovery by what it does to the *tree on disk*, not by what it does to commit history.
2. **Reading a Data-Loss Bug Off the Log Without Seeing It:**
   - *Trap:* The operator inspected the debug console log showing `storage.loadDocument` with `"headVersionId": "workspace:v0001"`, and shortly after saw `storage.recordVersion recorded workspace:v0001`. IndexedDB `put` overwrote the existing root version, destroying data.
   - *Root Cause:* The historical nextId counter in `src/db/versions.ts` was a module-level variable that reset to 1 on every page refresh.
   - *Fix:* Replaced with dynamic database query `highestSuffix(db, prefix)` inside an atomic transaction.
   - *Lesson:* Instrumentation does not observe on your behalf. A log scrolled past without analysis is not evidence.
3. **`bun run test` Passing on Broken TypeScript:**
   - *Trap:* A commit passed all 682 unit tests in Vitest while `tsc` was failing with syntax and import errors.
   - *Lesson:* Vitest transpiles TypeScript with esbuild without type-checking. A green test run does not prove compilation validity; running `bun run typecheck` is mandatory.
4. **Wire-Body and Eviction Test Blind Spots:**
   - *Trap:* Eviction tests in `test/debug.test.ts` passed against broken eviction code because `redact` in `src/debug/redact.ts` capped individual strings at 24,000 characters, so a test payload could never reach the 4MB buffer ceiling.
   - *Fix:* Added multi-event generators to drive real buffer pressure and verified failure via deliberate breakages.
5. **Defensive Telemetry Isolation:**
   - *Trap:* An instrumentation call in `src/db/db.ts` read `record.doc.shots.length` on deliberately partial test records, crashing `saveDocument`.
   - *Rule:* A telemetry sink must never break the host system it observes. `src/debug/` handles all logging defensively in memory, catches listener exceptions, and never writes to persistent storage.

---

## 6. Session 4 (2026-09-01): Conformance Harness & Local Evaluation

**Scope:** Local LLM conformance harness (`scripts/conformance-heylook.mjs`), thinking models, and prompt adjustments. Commits `cd497c6` through `c06e95a`.

### Key Traps & Discoveries

1. **Stage Separation as Primary Diagnosis:**
   - *Discovery:* The conformance harness separated evaluation columns into `provider` (HTTP/transport), `schema` (JSON parse/validation), and `diagnostics` (29 domain rules).
   - *Result:* When reasoning models failed, seeing consecutive failures in the `provider` column revealed that the upstream llama-server was returning 500 timeouts on busy backends, rather than the model failing to follow instructions. Upstream fixed the bug that afternoon (`c67cccb`).
2. **Negative Assertion Blindness:**
   - *Trap:* A test in `test/creative-integration.test.ts` checked that reworded prompt notes were absent by asserting `expect(prompt).not.toContain(note)`. When a prompt note was made unconditional and reworded, the test stayed green because the new wording matched neither string.
   - *Fix:* Replaced with whole-prompt composition equality checks (`styledPrompt === barePrompt + derivedDirective`).
3. **Sentence Mangling During Breakage Restoration:**
   - *Trap:* To test a breakage, an author removed a prompt sentence by regex. When restoring it, the author appended after a period that had been removed, creating a malformed sentence that broke contract tests.
   - *Rule:* Reverse a test breakage with the exact inverse of the edit that created it, never from memory.
4. **Stochasticity of Local Sampling ($n=1$ Trap):**
   - *Trap:* Comparing prompt variations across local models at $n=1$ produced conflicting results: the same idea and seed passed on one run and failed on the next.
   - *Rule:* Local generation comparisons require distributions across multiple runs ($n \ge 5$).
5. **Acceptance of `null` on Optional Camera Enums:**
   - *Trap:* Local models frequently emitted `"amplitude": null` and `"speed": null` instead of omitting the fields, triggering Zod schema rejections.
   - *Fix:* `PlannedShotSchema` in `src/core/ir/schema.ts` was updated to accept `z.nullable()`, and `plannerJsonSchema()` exposes `null` in the shape trailer.
6. **Per-Beat Speaker ID Conditioning:**
   - *Trap:* Local models emitted speaker IDs (`(S1)`) once per scene rather than repeating the attribution on every dialogue-carrying beat, triggering `SPEAKER_REF_MISSING_IN_PROSE`.
   - *Fix:* The planner prompt was reinforced with explicit per-beat attribution instructions.

---

## 7. Storage, Database & Key Vault Hard Rules

1. **Never name a version when opening IndexedDB:**
   Calling `openDB(name, 1)` skips upgrades if a database already exists at version 1, and throws an IndexedDB VersionError if an upgrade bumped it. Both `src/db/db.ts` and `src/crypto/secureStore.ts` open dynamically without a version number, inspect stores and indexes, and heal missing structures.
2. **Repair must never be a disguised reset:**
   `test/db.test.ts` explicitly asserts that existing user documents and version history survive schema healing migrations.
3. **`device` key mode is decrypt-only:**
   The legacy `device` key mode derived an AES key from `navigator.userAgent + navigator.language`, which is public. `WritableKeyMode` excludes `'device'`; existing envelopes can be read, but new keys can only be written to `'origin'` (non-extractable CryptoKey in IndexedDB) or `'passphrase'` (PBKDF2-HMAC-SHA256 with 310,000 iterations).
4. **Survey $\rightarrow$ Erase $\rightarrow$ Survey wipe protocol:**
   `src/db/wipe.ts` surveys existing row counts, deletes stores, and re-surveys to verify that 0 rows remain before reporting completion. It explicitly calls `closeDb()` beforehand to avoid being blocked by open connections.

---

## 8. Provider Layer Rules & Ground Truths

1. **Gemini Invariants:**
   - `store: false` is hardcoded and unchangeable (`interactions.delete` returns 501).
   - Never send `temperature`: Gemini accepts and silently ignores the parameter.
   - Never use `thinking_level: 'minimal'`: It returns a 400 error on `gemini-3.7-flash`. Valid levels are `'low'`, `'medium'`, and `'high'`.
2. **Sampling Temperature Ruling:**
   - By explicit repository owner ruling, sampling temperature must be **1.0 or higher**. Low temperatures and deterministic modes flatten descriptive vocabulary, degrading prompt quality.
3. **Constrained Decoding vs. Shape Trailers:**
   - Grammar-constrained decoding forces JSON compliance at the expense of natural prose token distributions.
   - `enforceSchema` defaults to `false` (`ENFORCE_SCHEMA_DEFAULT` in `src/provider/shape.ts`). When unconstrained, the engine appends `withShapeTrailer()` and parses defensively using `extractJsonObject()`.
4. **Single Wire Origin for CSP and Client:**
   - `VITE_HEYLOOK_ORIGIN` is the single source of truth for both `connect-src` in `vite.config.ts` and client connections in `src/provider/heylook/config.ts`.
