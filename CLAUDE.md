# H3 Transformation Engine — working notes

A prompt compiler and structured editor for MiniMax H3. Prompt-only; nothing here generates video.

One person tinkering. Not a product, no roadmap, no support, no reviewers, and possibly no users other than the owner. That is a licence to keep the code small and to delete things, not a licence to skip the controls below — the point of working this way is that nobody else is going to catch a mistake.

Read [README.md](./README.md) first — it carries the architecture, the provider findings, and the security posture. This file is the part that governs how to change the code.

## The two invariants

**1. Beats carry prose; enums are validated annotations.**

The planner writes the actual sentences. The serializer assembles structure around them — labels, timestamps, tags, section headers, alignment lines, ordering — and never expands an enum into a sentence. H3 conditions on descriptive quality, and a canned clause bolted onto a sentence is the "detached command stack" the official guide warns against.

**2. The prompt text is a pure function of the document.**

`serialize(doc, ctx)` is total and deterministic. Nothing may hand-edit prompt text, because every derived value — the alignment line, shot numbers, cut times, label ordinals — would immediately fall out of sync. If you find yourself wanting to patch the output string, the document model is missing a field.

## Hard rules

- **`src/core/` stays pure.** No React, no DOM, no network, no SDK, no `idb`. `test/purity.test.ts` enforces it. This is what lets the compiler run in a Node script or a CLI later.
- **Errors only in the validator.** There is no warning severity, and it should not come back. A diagnostic means the document is *provably* malformed. Anything that pattern-matches prose for a preference belongs in the planner prompt, not in `validate/`. Seventeen such rules were removed after they fired on legitimate output.
- **Every diagnostic code needs a control that makes it go red.** `test/validate.test.ts` scans the rule sources and fails the build if a code has no control. Do not disable that meta-test; it has itself been proven able to fail.
- **A creative selection travels; its directive text does not.** `CreativeModeRecord` — a mode and a set of pack ids — is the only form that is passed through `CompileInput` or written to a document. The style directive and the display label are derived from it at the point of use by `styleDirective` and `describeSelection`. This is invariant 2 applied one level out: a derived string kept next to its input is a string that can disagree with it, and the planner and patch prompts drifted apart the first time they were each handed a pre-resolved style in a different shape. `test/creative-integration.test.ts` asserts both prompts derive the same text from the same record.
- **The pack tables are the single source for their family.** Ids, names, directives and strength axes all come out of the one array in `src/core/creative/packs.ts`, with the id union derived as `(typeof VISUAL_PACKS)[number]['id']` the way `vocab.ts` does it. There is no second table of axes to fall out of step. Packs and anchors share one id space (`V01`-`V24`, `R01`-`R30`) so a visual selection is one string and one lookup, never a string-or-number branch.
- **The derivations tolerate ids they do not know; the schema does too.** A stored document can name a pack a later build renamed. `styleDirective` drops what it cannot resolve and returns null when nothing is left, `H3DocumentSchema` keeps pack ids as bare strings, and `StoredSelection` is the type that says so. Tightening any of these turns a renamed pack into a document that will not open.
- **The document schema reports, it does not gate.** `loadDocument` returns the record together with `schemaError`, and the UI surfaces it. A build that refuses to open what the previous build wrote loses work that exists nowhere else. `test/db.test.ts` pairs every "it is reported" with "it still opened".
- **`store: false` is not configurable.** Stored interactions cannot be deleted (`interactions.delete` returns 501). `test/provider.test.ts` fails if it changes.
- **Never send `temperature`.** Accepted and silently ignored by the API. There is no temperature control in the UI and there should not be one.
- **Never use `thinking_level: 'minimal'`.** It 400s on gemini-3.7-flash. The SDK's type union spans all models; ours is narrowed to `low | medium | high`.
- **`device` key mode is decrypt-only.** It derived the AES key from `navigator.userAgent + navigator.language`, which is public. `WritableKeyMode` excludes it so `tsc` rejects a write; `setSecret` also throws at runtime for untyped callers. Old envelopes must keep opening — deleting the read path loses people's stored keys.
- **Never name a version when opening a database.** `openDB(name, 1, ...)` skips `upgrade` on a database already at version 1, and asking for version 1 after a repair throws `VersionError`. Open whatever is there, treat the presence of the stores *and their indexes* as the test, bump only when something is missing. Both `src/db/db.ts` and the vault in `src/crypto/secureStore.ts` do this. An empty database at version 1 is reachable — anything else on the origin doing `indexedDB.open('H3TransformationEngine')` creates one — and without the repair the app breaks permanently with nothing to explain it. Repair must never be a disguised reset: `test/db.test.ts` checks that existing rows survive it.
- **Erasing reports what storage says, not what the code did.** `src/db/wipe.ts` re-reads counts after deleting and can return `clean: false`. Do not replace that with an assumption that the call worked; `closeDb()` before deleting is load-bearing, since an open handle blocks `deleteDatabase` indefinitely.

## Where the truth lives

`src/core/ir/vocab.ts` is contract, not preference. Every value in it should be traceable to a line in one of the two official MiniMax guides:

- Video Prompt Writing Guide (T2VA / I2VA / FL2VA / L2VA) — the base contract
- Full-Reference Mode Rewrite Output Format Guide — the Ref2VA contract

When those guides and any secondary source disagree, the guides win. Several confident recommendations from a community kit and a design transcript were rejected because the golden fixtures — byte-exact reproductions of the guides' own worked examples — falsified them. Notably: citing `<Picture N>`/`<Audio N>` inside the timeline is *correct* (both guides do it), retention notes *do* repeat traits deliberately, `(S1)` is used even with a single speaker, and the FL2VA alignment line is bare, not bracketed.

If a proposed rule would turn a golden fixture red, the rule is wrong.

## Testing

```
bun run test        # 227 tests (vitest)
bun run typecheck
bun run build
bun run probe       # live API probes; reads GEMINI_API_KEY from .env
```

A check is unverified until it has been shown to go red for the right reason *and* green for the right reason. Write the control that makes it fail, run it, then trust it.

Storage and crypto tests run against `fake-indexeddb` (a devDependency, not in the bundle) with a `localStorage` stub, so deletes and round-trips are real rather than mocked. What that cannot cover is the browser: **click the thing.** Both bugs that mattered in the storage work — a caller still passing the retired `device` mode, and a vault database wedged at version 1 — passed every unit test and broke the running app. So did the third: a creative picker holding its own copy of the selection, which showed a restored style in its badge but not in its controls and then destroyed it on the first change.

## Conventions

- `bun`, not npm or yarn. Never edit `bun.lock` by hand.
- No emojis in code, comments, docs, or commit messages.
- Keep `CHANGELOG.md` current. Semver, no dates.
- Commit freely; never push without being asked.
- Paths written into the repo must be relative to the repo root.

## Open work

- Video and audio reference analysis (Files API upload, PROCESSING polling, 48h handles). Those slots currently take a written description, which means any subject derived from them is built on that text alone — the planner prompt says so explicitly.
- Planner prompt tuning against real H3 output. Everything verified so far is grammar. Whether the prose conditions H3 *well* is unmeasured, and it is the main open question.
- Visual design.
