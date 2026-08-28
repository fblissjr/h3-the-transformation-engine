---
mode: session
scope: glitch-wildcards-contract
date: 2026-08-28
summary: Every feature shipped, and four independent audits found roughly forty defects in them — concentrated in the artifact built to catch drift, because the spec's own prose had no check on it.
artifacts:
  - CLAUDE.md
  - VISION.md
  - reference/h3/VIDEO_PROMPT_WRITING_GUIDE_base_en.md
  - reference/h3/contract.json
  - src/core/serialize/ref2va.ts
  - src/core/validate/rules/speech.ts
  - src/core/wildcards/expand.ts
  - src/core/wildcards/matrix.ts
  - src/pipeline.ts
  - src/ui/CreativePanel/CreativePanel.tsx
  - test/contract.test.ts
  - test/creative-integration.test.ts
  - test/fixtures/exercised.ts
  - test/guide-fidelity.test.ts
  - test/ref2va-labels.test.ts
  - test/validate.test.ts
  - 0657768
  - 2288a89
  - 2b6285f
  - 75e7e0d
  - 958729f
  - a95ae8c
  - b1dc534
  - ba179c0
  - c15714a
  - e381c42
  - f13ee85
---

# Session: glitch marks, wildcards, and the H3 contract

Range `ba179c0..a95ae8c`, 28 commits. Tests 235 → 544.

## 1. What went well

**Extracting the spec found bugs before any test did.** Writing
`reference/h3/contract.json` required stating what each mode's output must look
like, and doing that against the guides surfaced the `speakerRef` duplicate
(two renderers of `(S1,S2)`, one of which sorted ordinals as strings) and
`REF_DETAIL_WORD_RANGE` defined and consumed by nothing (2288a89). Neither was
reachable by a test; both were found by having to write the claim down.

**A control aimed at a class kept catching the next instance.** `test/contract.test.ts`
was written to bind spec to code; when `CUT_STYLE_NOT_IN_PROSE` was deleted it
immediately failed on the orphaned diagnostics entry, unprompted. The
attribution check added in c15714a found `modes` uncited on its first run —
the same shape as the two entries an outside audit had just found by reading.

**Moving the guides into tracked space made a standing claim checkable.**
`reference/h3/VIDEO_PROMPT_WRITING_GUIDE_base_en.md` was in a gitignored tree,
so "every value in `vocab.ts` traces to a guide line" could not be verified from
a clean checkout. `test/guide-fidelity.test.ts` now compares the golden text to
the guide files directly and hashes them in the spec.

**The parallel clone's `withGlitch` was better than my fix for the same bug**
(958729f). I spread the glitch key inline at each call site; they derived it in
core, which converts a UI-clicking case into a test. Merged theirs.

## 2. What did not go well

**Four audits found roughly forty defects, and the densest concentration was in
the artifact built to prevent drift.** An outside audit found four
misquotations of the guides (f13ee85), three of which I had written into
`reference/h3/contract.json` hours earlier: the ref 5.2 word range quoted
without its scope, `VOICEOVER_PHRASE_MISSING` catalogued as checking a clause
it never checked, and `slotCeilings`/`mediaKinds` sitting unmarked among
guide-cited entries. The structural version: **a spec that checks the code
against itself proves only that they agree; nothing in that loop can detect
that both are wrong.**

**Three defects shipped inside the same session that added the rule forbidding
them.** CLAUDE.md gained "a creative record has two independent halves, and
every caller reads both"; the marks were then dropped by three separate
handlers — the preset click, the Off button, and `DirectedControls` (0657768,
958729f). CLAUDE.md gained "before leaving one exported, check that something
calls it"; `rerollSeed`, `getGlitchToken` and `getGlitchSurface` shipped with no
callers in the same diff.

**A fix introduced a worse defect than the one it removed.** Preserving glitch
marks through the Off button required returning a record, and a record needs a
mode, so Off set `directed` — which lit the Directed button, opened its
controls, and made a second Off press a no-op. Off was unreachable while marks
existed, and the comment I wrote claimed the opposite
(`src/ui/CreativePanel/CreativePanel.tsx`, fixed in 0657768).

**I asserted a guarantee held by construction when it holds by maintenance.**
VISION.md said no transform could reach a timestamp "because there is no path to
the thing it would have to break". The path is `PATCHABLE_LEAVES`, and
`shots[].cutAtMs` is on it (75e7e0d). Both readings make the same true claim
today and diverge only under a later edit, so no test separates them.

**Three breakages came back green because I aimed them at the wrong line, and I
reported the first pass before checking.** In the `matrix.ts` prototype fix, two
guards only fail together; my first battery removed one at a time and read the
greens as a result rather than as a question about the breakage.

## 3. Deviations from the plan

| Planned | Shipped | Verdict |
|---|---|---|
| Find the glitch code in the older repo | Found it, and it was never implemented there — design docs only, with an explicit "do not implement" decision | Better than planned: the search answered a different, more useful question |
| Port the glitch system | Ported as scene-placed marks (2b6285f) | Scoped down honestly. The owner's framing was "glitch the prompt and parts of it"; what shipped is one transform of many, and structural corruption was considered and rejected |
| Verify prompt structure, build a canonical source of truth | `reference/h3/contract.json` plus tracked guides and two-directional conformance | Better than planned. The first attempt was a human-readable README; the owner corrected it to a machine-readable artifact |
| Wildcards and the experiment matrix | Both, with seeded rolls recorded on the document | As planned |
| Public-figure rule | Shipped in both prompts with a carve-out for verbatim fields | Better than planned: the carve-out is a constraint the source fragment did not have and this compiler needed |
| (unplanned) VISION.md | Written, then corrected by the parallel clone | As requested |
| (unplanned) Fixing audit findings | Four rounds, ~28 fixes | Cost sink not budgeted for, and larger than the feature work |

## 4. Escapes (tests)

**Missing tests — nothing was watching.**

- Golden fixtures had drifted from the guides by 13 characters (U+2019 for
  ASCII apostrophes) across `T2VA` and `Ref2VA`. Every byte-exact test passed
  because it compared the serializer to a copy that was already wrong. No test
  compared the fixtures to the guides; `test/guide-fidelity.test.ts` now does,
  plus a character-set check that needs no guide on disk (2288a89).
- A wildcard placeholder could reach the H3 prompt on three paths while
  `src/core/wildcards/expand.ts` documented that it could not. Fixed at the
  boundary the claim is about, in `src/pipeline.ts` (b1dc534).
- `{constructor}` resolved to `Object.prototype.constructor` and was stringified
  into every matrix cell; the result carries no matchable placeholder, so it
  also defeated the guard added the same day (`src/core/wildcards/matrix.ts`,
  0657768).

**Green-but-blind — the test existed and was looking at nothing.** This is the
repeated shape of the session.

- Deleting the creative-mode stamping from `compile` left all ~400 tests green,
  because it sat past the model call where nothing could reach it. Same for the
  roll record. Both moved into `assemble`, which tests can reach.
- Four validator rules asserted "this code does not fire on known-good input"
  against a corpus containing no voiceover, no on-screen text, no line crossing
  a cut and no truncated speech — measured directly: `crossesCut: 0, cutoff: 0,
  voiceover: 0, visibleText: 0`. `test/fixtures/exercised.ts` fills the gap and
  `Control.inspects` in `test/validate.test.ts` now refuses a hollow green.
- Ref2VA rendered the guide's own `<Video 1>` retention line under `<Audio 1>`
  with a green validator, because coverage keyed by slot rather than by label
  and no fixture had a dual-labelled slot (`src/core/serialize/ref2va.ts`,
  e381c42, now `test/ref2va-labels.test.ts`).

**Rules that fired on legitimate output.** `CUT_STYLE_NOT_IN_PROSE` was added
and deleted within the session — the serializer never reads `cutStyle`, so the
document it flagged rendered perfectly. `DIALOGUE_BAD_TERMINAL` demanded a
terminal mark on the first half of a line crossing a cut and on truncated
speech, both incomplete by construction; found only by writing a fixture that
used them (`src/core/validate/rules/speech.ts`).

**Tests added that measure the wrong thing.** A survey counted 83 prose-shaped
assertions: 29 anchor on data the code owns, 23 are typed only into a test, 31
pin prose inside a prompt template. One of the 31 failed during a rebase when
the parallel clone reworded an instruction to say the same thing better —
nothing broke, the test was measuring wording
(`test/creative-integration.test.ts`).

**Three or more green-but-blind escapes is the documented trigger for a full
`test-audit`.** See forward item 1.

## 5. Forward items

1. **Run `test-audit` on the whole suite.** Trigger met: four distinct
   green-but-blind escapes in one session. Done when the audit reports, or
   refuted if it finds fewer than two additional hollow assertions outside the
   areas already fixed.
2. **Retarget or delete the ~15 remaining sentence-level prompt assertions in
   `test/creative-integration.test.ts`.** Each is labelled a wording proxy but
   still fails on a reword. Done when the count of literals pinning prompt prose
   (currently 31, of which ~10 are headings or field names) drops below 15, or
   wrong-premise if prompt wording proves stable over the next three sessions.
3. **Check whether `Control.inspects` predicates stay honest.** The mechanism is
   satisfiable by `inspects: () => true`. Done when a later reader confirms every
   predicate still names a real gate, or refuted the first time one is found
   returning a constant.
4. **Decide whether marks belong inside `CreativeModeRecord` at all.** The Off
   button defect traces to marks living in a record whose `mode` describes a
   style they are unrelated to. Done when marks are lifted to their own field or
   the coupling is deliberately affirmed in CLAUDE.md.
5. **Reconcile `package.json` version 0.1.0 with CHANGELOG's `[0.3.0]`.** Raised
   during the session and never answered; there are no git tags. Done when the
   two agree or the mismatch is recorded as intentional.
6. **Nothing in the suite can catch a claim in `contract.json` that is wrong in
   the same way the code is wrong.** Attribution and coverage are checked now;
   the prose is not. Done when a second reader audits the spec's prose against
   the guides, or wrong-premise if the next audit finds no such defect.
