# Plan

last updated: 2026-09-06

Working to-do across three tracks, and the record of what is deliberately not
being done. Not a roadmap: it is the order the owner intends to take open
questions in, kept in the repo so the sister project can read it.

Rewritten on 2026-09-06 because the previous version, written at `4fb0869`,
covered only the planner-prompt track. Two other tracks had appeared since and
the file described neither, while the documents driving them sit in `internal/`,
which is gitignored — so the sister project was reading a plan with none of it.

## How to read this

Three tracks, one owner each, running concurrently on one working tree.

| Track | Covers | Detail lives in |
|---|---|---|
| A. Storage and server | SQLite store, bun server, seam swap, run records | `internal/server-plan_2026-09-06.md`, `internal/data-model_2026-09-06.md` |
| B. Prompt and guides | Planner and patch prompts, guide coverage, graders | `internal/prompt-audit_2026-09-06.md` |
| C. Provider and roles | The `InferenceClient` seam, per-role bindings, heylook presets | `wiki/roles_and_bindings.md` |

The `internal/` documents are gitignored and hold the reasoning; this file holds
the state. When the two disagree, this file is stale and the internal one is not.

## Standing facts this plan rests on

- heylook is the primary backend. Prompt changes are weighed against a local
  model with no constrained decoding, not against Gemini.
- heylook's maintainers have said constrained decoding will not be added, so
  the `enforceSchema` A/B is Gemini-only and secondary.
- The only writer-model evidence anywhere is this repo's: one session on a 26B
  MoE, plus two single observations (a 0.8B failed the schema on camera
  amplitude, a 27B dense validated). Nothing has been rendered through H3 from
  a prompt this repo's planner wrote.
- The sister project, ComfyUI-h3-explorations, renders H3 through custom
  ComfyUI nodes and writes its prompts by hand. It has no local writer model and
  no reason to know what heylook is. It is an authority on the vendor guide
  hashes, the tokenizer config and its graders. Its prompt corpus is not a style
  source.
- The two repos agreeing is consistency, not corroboration. The only independent
  source either has is MiniMax's guides and tokenizer config.
- The app talks to the server for documents, versions and settings as of
  `fd9bd87`. The Gemini key vault is the one thing still in IndexedDB, by
  decision rather than by lag.

## Track A: storage and server

Moving the library off IndexedDB onto SQLite, and starting to record what
produced each document. Phases are lettered in
`internal/server-plan_2026-09-06.md` and ordered by file contention.

Landed:

- [x] **Schema and store**, `server/schema.sql` and `server/store.ts`, outside
      `src/` so Vite cannot bundle a native module. Library half is a JSON
      document body with VIRTUAL generated columns; measurement half is a wide
      append-only `runs` table with `experiments` and `arms` grouping.
- [x] **Schema lineage.** `PRAGMA user_version`, pinned against a hash of
      `schema.sql` so a forgotten bump goes red. A database this build cannot
      write opens read-only and reports, rather than refusing or migrating.
      `exportTables` works on exactly those files, which is what makes the
      read-only answer acceptable rather than hostile.
- [x] **`WritableDb` is a branded type**, so narrowing is what produces a handle
      the write functions accept.
- [x] **Phase A**, `describeSchemaFailure` deduplicated into `src/core/`.
- [x] **Phase B**, the bun server: static files and the API at one origin.
- [x] **Phase C**, `/api` proxied in dev, so the browser is same-origin in both
      modes and `connect-src 'self'` needs no change.
- [x] **Phases D and E**, landed together at `fd9bd87`: the document store moved
      to SQLite over HTTP, and erase now reports across the process boundary.
- [x] **Phase G**, the originating idea persisted. Holds the expanded idea, not
      a template: `CompileInput.idea` is already expanded when it reaches
      `compile`, and `doc.roll` is absent whenever no wildcards were used.

**One document store, and a vault beside it.** As of `fd9bd87` the library is on
SQLite: `src/db/db.ts` is an HTTP client with every signature unchanged, so the
swap never reached its call sites. Saying "we removed IndexedDB" would be wrong
in the other direction — `idb` is still imported by two files, and both are the
key vault: `src/crypto/secureStore.ts`, and `src/db/wipe.ts` for the vault delete
only. That is deliberate. With no inference proxy the browser calls Gemini
directly, so the key has to be in the browser, and moving that store to SQLite
would put an API key on the server's disk.

Three things closed with it, each of which this file previously tracked as a
known state rather than a bug:

- **`documents.idea` is written**, at both save sites. On checkout it is
  re-rolled from that version's own template and seed rather than read off state,
  because `setIdea` has not taken effect within the tick — the naive version
  would have recorded the idea of the version being *left*.
- **Erase re-reads its counts server-side** and returns 200 with them even when
  rows survive, and the survey covers `runs`, so `raw_output` cannot hide behind
  a clean report.
- **Version id allocation moved to the server**, inside one transaction, with
  `rootId` derived there rather than accepted. The read-then-write race the
  IndexedDB transaction guarded is now prevented by SQLite plus a single writer,
  which is strictly stronger.

Two notes worth keeping rather than dropping:

- **Ordering by timestamp was assumed unique twice in this arc.** Two versions
  written in the same millisecond tied on `created_at` and fell back to storage
  order. Ids are zero-padded and break the tie. Found by the tests, not by
  review.
- **Four IndexedDB repair cases retired and the reports-does-not-gate pairing did
  not.** The retired four guarded `openDB(name, 1)` skipping its upgrade, which
  cannot happen against SQLite, and `store.test.ts` already asserts the
  replacement property. `fake-indexeddb` was only ever the harness; the pairing
  now runs against the real store. All three storage test files route `fetch`
  into the real route handler, and deleting one route turns five tests red across
  three files.
- **`mustWrite` has no production caller and that is now a decision, not an
  oversight.** The routes narrow `Opened` themselves, which is the
  degrade-gracefully path, so the only caller that would want it is a startup
  that cannot proceed read-only — and there is deliberately no such startup. It
  stays as a test helper with that stated in its comment; the alternative is
  deleting it and having every test narrow by hand.

Open, in order:

- [ ] **Phase F, `recordRun` into `pipeline.ts`**, with `raw_output` retention
      shipping in the same phase rather than after it. Kept separate from D and E
      because it is a different file and a different risk.
- [ ] **The additive-column path**, using `pragma_table_xinfo` where `hidden` is
      0. Deferred until a change is genuinely additive and a version bump would
      be wrong. The cost side belongs next to that condition: until it exists,
      every schema change bumps `user_version`, and every bump puts existing
      development databases into read-only. Cheap now, annoying once anyone has
      data they care about.

## Track B: prompt and guides

Landed since 2026-09-01:

- [x] **Prompt inventory**, rendering every prompt and reporting what claims it.
- [x] **Guide-coverage ledger**, `reference/h3/guide-coverage.json`: 183 stated
      sentences pinned, 69 covered against resolving `contract.json` paths, 4
      declined with reasons, 110 unverified of which 28 look normative — as of
      `708d45b`. **Re-derive rather than trust these: `bun run coverage`.** They
      move as the backlog is worked and the ledger is the live source; a number
      transcribed into a plan is exactly the stale-copy shape this repo keeps
      finding. Pins the
      guide hashes beside each disposition, with a three-way check against
      `contract.sources` and the live files.

      **Checked is not complete, and the split is deliberate.** Only the faults
      are in the suite: `test/guide-coverage.test.ts` asserts the problem list is
      empty. The 110-sentence backlog is not, because a test failing on those
      would be permanently red, which is the state people scroll past. So "the
      ledger is checked" is true and "the ledger is complete" is not, and only
      the second has a condition on it.

      It has already produced a finding neither track had: ref 5.4's off-screen
      marking for a defined subject exists in neither the spec nor the prompts,
      recorded as F9 for an owner ruling.
- [x] **The recognisable-people block reverted**, spec and tests together, after
      spec-first was caught mid-flight with no implementation.
- [x] **Local-model conformance harness**, `scripts/conformance-heylook.mjs`,
      run once on 2026-09-01; results in the archive below.

Open:

- [ ] **Grader bridge.** A script writing serialized prompts in the shape the
      sister project's `bench/grade_prompt_text.py` consumes. A mechanical
      oracle only: it is silent on shown-versus-house and cannot see the marker
      divergence in decision 1 at all.
- [ ] **Paired idea set with the sister project.** Their bank manifest is the
      bridge contract; the harness should emit the same shape. Caveat that the
      item did not originally carry: their corpus is useful for grading
      conformance and must not become the route by which their prose conventions
      arrive as ours. It runs at roughly 93% `non_diegetic_music: N/A`, further
      along that axis than the fork it came from.
- [ ] **Render the marker question** (decision 1). Cannot be done here. While it
      is open it imposes a live constraint rather than merely waiting: prompt
      changes are being kept clear of marker spellings and nothing is being
      hardened around them, which is sustainable only while it is written down.
- [ ] **A/B the worked-example block on a weaker model**, reading the
      placeholder and speaker-id columns separately. `--strip-example` in the
      conformance harness is the instrument.

      It now has a *partial* sibling. The patch prompt's derived-section framing
      was changed at `b5b98f9`, and the two halves have different standing. The
      duplication it removed was an established defect — two top-level headings
      per section, and a wrapper instructing the model to disregard the paragraph
      directly beneath it — which needed no render to see. The reframing that
      came with it, from planner-voiced to preservation-voiced, is a content
      change whose effect is unmeasured in exactly the way the example block's
      is. So the measurable question here is not "which arm is better" but the
      narrower "did the incoherence cost anything", and only the second half
      belongs beside this item.
- [ ] **F9: ref 5.4's off-screen marking for a defined subject.** A stated guide
      rule present in neither the spec nor the prompts. Spec-first if it is
      wanted, and an owner ruling either way.
- [ ] **F1: whether the planner preamble gets a spec shape.** Measured rather
      than argued. Two deletion arms — the invariant-1 paragraph alone, and the
      whole preamble — each left the suite at 943/943 green, against a positive
      control that went red on exactly one assertion. The control is what makes
      those greens mean anything: nothing-noticed is a fact about coverage, not
      about the harness. So the preamble is genuinely unprotected, and whether
      that matters is the decision.

      A structural consequence to settle with it, not after: `contract.json`
      declares blocks by heading and `test/contract.test.ts` locates each one
      with `text.indexOf(heading)`. A preamble has no heading, so speccing it
      means giving it one, changing how blocks are located, or declaring it as
      something other than a block. The third looks right — the preamble is what
      precedes the block list rather than a member of it — but it is part of what
      F1 decides.
- [ ] **The residual placement instruction in the glitch block.** "Give each mark
      a different kind of surface" is still placement guidance in a preservation
      context. Milder than the two already fixed, and removing it means first
      deciding whether an assisted edit should see the surface vocabulary at all.
- [ ] **Decide the thinking default, now that the control is `auto | on | off`
      rather than a boolean.** `auto` sends no switch and lets the server's own
      cascade decide, which is a third option the original measurement never
      covered: off and medium were measured against each other, and neither is
      `auto`. So this is not "pick the winner of the two measured arms" — it is
      first deciding whether the app should have an opinion at all, and only then
      which. Measuring `auto` against the two is the missing arm. The app still
      sends `off`, which was never a verdict.

## Track C: provider, roles and presets

Landed:

- [x] **Thinking is `auto | on | off`.** `auto` sends no switch, so the server's
      cascade decides. Previously the client sent an explicit `false` to every
      capable model, which was an override rather than a default.
- [x] **`runs.role` typed to the seam's own `Task` union**, so the binding key
      and the recorded role cannot drift into two vocabularies.
- [x] **An optional per-instance bearer token on the heylook client**, sent on
      both the call and the cancel through one renderer. Nothing wires it yet.

Open, in order:

- [ ] **Wire the bearer token** through `buildClient` and the engine. Waits on
      track A's contended files.
- [ ] **Video analysis behind `InferenceClient`**, with a `contract.json` entry
      for its prompt. It is the only model call outside the seam and the only
      prompt with no contract entry. First analysis role.
- [ ] **Per-role bindings.** The structural item: one binding row per role
      rather than a single global provider setting. Needs track A's storage.
- [ ] **The heylook preset import.** Sampler half onto the client config,
      direction half through `CompileInput` and onto the document, with the
      preset's own `system_prompt` reaching the planner as a named direction
      block rather than replacing the contract-bound system prompt.

      **Last by sequencing, not by priority.** Reading heylook's presets is the
      request this entire arc started from; everything above it is foundation
      that turned out to be required first. Recorded explicitly because a reader
      three weeks from now would otherwise conclude it was dropped.

## Decisions made

- **2026-09-06, per-role bindings: yes.** The one structural decision. A global
  provider setting cannot express Gemini analysing an image while a heylook
  model writes the prose.
- **2026-09-06, no inference proxy.** The server serves static files and owns
  SQLite; it is not in the inference path. So instance origins stay build-time,
  the vault stays, and heylook's retry loop and cancel stay client-side.
- **2026-09-06, no database encryption.** `PRAGMA key` is a silent no-op on this
  platform's SQLite, and a key the server reads unattended defends against
  nothing that runs as the same user.
- **2026-09-06, pin the SQLite engine** rather than inherit the OS one, on plain
  `better-sqlite3`.
- **2026-09-06, snapshots not deltas** for version bodies. A delta chain is only
  as good as its ancestry; a snapshot is independently openable.
- **2026-09-06, keep raw planner output**, with retention as a setting read at
  write time rather than a cleanup job.
- **2026-09-06, read-only boot.** A database this build cannot write opens
  read-only and says so loudly; it never refuses to start.
- **2026-09-06, heylook auth: design now, enable when first off-loopback.** One
  optional bearer token per instance. Access patterns are LAN and Tailscale
  only, and Tailscale is not assumed to be on.

## Decisions pending (owner)

1. **Which artifact the compiler targets: the guide text or the release
   tokenizer.** Decides the marker set. Do not move until one split line and one
   truncated line are rendered both ways.
2. **Target local model class.** The prompt-length trade runs opposite ways for
   a small-active MoE and a large dense model. Also settle whether heylook
   reuses the KV prefix across calls.
3. **Whether the schema trailer becomes a plan instance.** A prompt-quality bet
   with no measurement behind it; same standing as the example block.
4. **Whether the two projects' rule sets stay deliberately separate.**
   Recommended: yes, each traced to the guides and tokenizer independently, and
   recommended that it be **stated now** rather than left open. It has been
   load-bearing twice in one day without being decided — their corpus was
   declined as a style source, and their stated-versus-shown rule was adopted.
   Both were the right calls and both were made ad hoc against an undecided
   question.
5. **Whether the server ever runs off this Mac.** Decides whether prebuilds for
   non-darwin targets matter.

## Not doing, and deferred with conditions

- **An outcome channel on the version tree.** Deferred, not rejected. The schema
  half exists; the UI half is unclaimed. Build it when someone has rendered
  prompts out of this app, judged them, and found they wanted somewhere to put
  the answer. A field nobody fills in is worse than no field, because it looks
  like data. The distinction that keeps this honest is in `CLAUDE.md`: an
  unrecorded *input* is not a missing place to put a finding, which is why
  idea-persistence was live while this is not.
- Adopting the sister project's mouth-cue rule as it stands. This repo carries
  the narrower "a held facial state cannot survive the line that breaks it".
  Whether to add the positional form waits with decisions 2 and 3.
- Taking a side on H3 prompt length. Their two length results point opposite
  ways.
- Per-provider `enforceSchema`. Reopens only if a third backend can enforce.
- Treating a local writer model as a shared concern. It is this repo's alone.
- Roles as user-definable data. A role is a call site and a call site is code.

## Working rules for a shared tree

Three sessions have been committing to one checkout. Both of these were learned
by being bitten, not predicted:

- Re-read a shared file immediately before editing it. A clean `git status` is a
  snapshot, not a lock.
- Commit by explicit pathspec and verify the commit contents afterwards. Never
  `git commit -a`, never `git add .` — another session has had files staged
  between one session's status read and its commit.
- If a suite fails at load across unrelated files, check `which node` before
  believing the tree. Three sessions lost about an hour to a dead `nvm` path in
  `PATH`: with no node, vitest falls back to bun, and bun plus vitest plus zod 4
  dies at `z.object`. All three of us searched `node_modules`, because each had
  already decided the runtime was fine. The general form is the better one — a
  non-zero exit from an incidental command inside a diagnostic batch is a
  finding, not noise.

## What the sister project needs from here

They have the same two guides and the same spec-versus-code binding, so the same
blind spots. These transfer; the rest of our internal notes are about this app's
prompts and are not facts about H3.

- **The coverage direction and the ledger's shape.** Asking whether the spec
  accounts for what the guides *state* is the direction nothing else checks, and
  the mechanism transfers whole.
- **Stated versus shown: an example can refute a rule and cannot establish one.**
  Broken here once and written down as a result. The cheapest thing on this list
  to get wrong.
- **F6, F7 and F9 as findings**, since all three are guide rules rather than app
  quirks. A ref-guide rule missing from one spec is either missing from theirs or
  not, and that is cheap for them to check.
- **The engine limits**, already vendored at `reference/engine-limits.md`,
  including both unenforced-bound notes.

Staying internal: the block-by-block prompt inventory, F1 through F5, the
patch-prompt framing history, and the corpus-findings note.

## Archive: measured 2026-09-01

The two-local-model conformance run, the sister-project exchange of 2026-09-01
and its verified findings are preserved in this file's history at `e6378f8`.
They are not repeated here because nothing in them has changed and the sections
above are what is live.
