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

- [x] **Phase F**, `recordRun` and retention, landed at `a9320fb`. **That closes
      A through F: the storage track is done.** `compile` fires an observation on
      every path including the failing ones, which are the point — a table of
      successes answers none of the questions, since "did thinking-on improve
      conformance" is a comparison of failure rates. The pipeline knows the
      stage, the timing and the reply and does not know the model, the document
      or the arm, so it hands out half a record and the caller completes it.
      Recording is fire-and-forget on `src/debug/`'s own rule: a lost row is a
      gap in the data, a thrown one is a lost document. Retention is enforced
      inside `recordRun` rather than at the caller so it holds for a caller that
      forgets, and off means NULL rather than truncated, because a partial prompt
      is not evidence and is still prompt text on disk.
- [ ] **`runs.arm_id` is never set.** `experiments` and `arms` exist and nothing
      writes them, because no experiment has yet been run through the app — the
      conformance harness is still what runs arms. Correct today; wrong the
      moment two configurations are compared from the UI.
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
- [x] **F1 ruled: both prompt preambles are claimed and neither is asserted.**
      Owner ruling 2026-09-06, at `73c98c1`. See Decisions made.

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
- [ ] **The three structural things `SHOT_HEADER_IN_PROSE` does not cover.** The
      planner preamble names four things the model must not write, because code
      adds them: shot numbers, cut timestamps, section headers and the alignment
      line. The diagnostic covers the first. The other three were measured on
      2026-09-06 and are all uncaught — a beat carrying `At 00:04.000,`, one
      carrying `overall_soundscape:`, and an FL2VA beat carrying an alignment
      line each validate at **zero diagnostics**.

      **Deferred deliberately, and not as a batch.** They are not automatically
      rules just because the first one was. The shot header earned its diagnostic
      by being provably a contradiction — the serializer emits that exact header,
      so a beat containing one renders doubled — and by surviving a refutation
      grep across the fixtures and a false-positive test. Of the remaining three,
      only the snake_case section header looks as unambiguous. A bare timestamp
      is the risky one: a beat may legitimately describe a clock face or a
      countdown, and the `visibleText` exclusion does not help, because a
      timestamp need not be on-screen text. `First frame -- last frame` is close
      enough to ordinary prose that it needs falsifying before it is believed.

      Each needs its own evidence before it is written, and the instrument is
      cheap: mutate a fixture beat, run `validate`, then run the same pattern
      against a legitimate document. The mistake available here is adding all
      three because the first one worked.
- [ ] **The residual placement instruction in the glitch block.** "Give each mark
      a different kind of surface" is still placement guidance in a preservation
      context. Milder than the two already fixed, and removing it means first
      deciding whether an assisted edit should see the surface vocabulary at all.
- [x] **The thinking default is `auto`**, by the owner's ruling of 2026-09-06.
      `auto` sends no switch and lets heylook's own cascade decide, which since
      1.79.62 resolves to the model's `models.toml` flag and then to whether it
      can think at all. `off` was what shipped and was never a verdict: it rested
      on one measurement on one 27B gguf, and it was an *override* rather than a
      default, since the client sent an explicit `false` to every model whose row
      advertises the switch. Measuring `auto` against off and medium is still the
      missing arm, and is now a comparison the app can actually participate in.
- [x] **The thinking preference is wired**, `806cf81`. `ClientParams.thinking`,
      passed by `buildClient`, sourced in `useEngine` as a stored setting read
      defensively, with a three-state control in the heylook panel. Default is
      `auto`.
- [ ] **Wire the bearer token's engine half.** The seam is done — `7b70dce` put
      `heylookApiKey` on `ClientParams` and `buildClient` passes it, asserted
      through to the wire on both the call and the cancel. **What remains is a
      source.** Concretely, for whoever picks this up:

      1. A vault secret beside the Gemini key. `getSecret`/`setSecret` in
         `src/crypto/secureStore.ts` are name-keyed, so this is a second name and
         needs no vault change. `API_KEY_NAME` in `src/ui/useEngine.ts` is the
         pattern to copy, including the passphrase-mode handling around it.
      2. State and a load in `useEngine`, then `heylookApiKey` into the
         `buildClient` call at the `useMemo` around line 870.
      3. A field in the heylook branch of `src/ui/ProviderPanel.tsx`, beside the
         thinking control that just landed.

      It blocks nothing today: heylook's key is loopback-exempt, so a server on
      this machine needs no token. It becomes required the first time heylook is
      started with a non-loopback `--host`, which is the same day cross-machine
      access starts working.
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

- **2026-09-06, F1: the preambles are claimed and neither is asserted.** Both
  system prompts open with text before their first heading, which no spec entry
  described and no test could reach — `test/contract.test.ts` slices each block
  from its heading forward, and a preamble has none. It is now
  `prompts.planner.preamble` and `prompts.patch.preamble`, with `asserts: []` and
  the reason in `noAnchor`.

  **The ruling went against protecting it, and the arms are the reason.** A
  wording anchor is refuted by the same argument that gives `# How to write` its
  own `noAnchor`: a reworded preamble that says the same thing better turns it
  red, which is a change detector rather than a test. A presence floor survives
  that rewrite but stays **green** through a preamble gutted of its meaning and
  refilled to length, so it is a tripwire against outright deletion and not
  protection of the invariant. A green check beside the planner's most
  load-bearing paragraph would have read as more than it was.

  What made "no" defensible rather than resigned is that the gap has a control
  now, from the other direction: nothing in `assemble`, `validate` or `serialize`
  inspected beat prose for the structure the serializer owns, so the preamble was
  the only thing standing there. `SHOT_HEADER_IN_PROSE` closes one quarter of
  that, and the rest is an open item above.

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

**Three of the five below cannot be settled here and are blocked on a render
this repo cannot perform: 1, 2 and 3.** That is a property of the questions, not
a backlog — nothing has been rendered through H3 from a prompt this repo's
planner wrote, so each needs the sister project's render path or a session on
real hardware. They are listed rather than dropped so their blocked state is
visible instead of read as neglect.

1. **Which artifact the compiler targets: the guide text or the release
   tokenizer.** Decides the marker set. **Half of this is now answered, and it
   was never blocked on a render** — it was a lookup against an artifact already
   on disk, which is the failure the held-evidence rule names, committed into
   the file that states it.

   **The glitch marks are not anomalous under H3's own tokenizer.** Its text
   encoder is `Qwen2Tokenizer`, vocab 151643; the marks are GPT-2 vocabulary
   anomalies. Different vocabulary, different corpus. All ten decompose into
   ordinary subword tokens — `SolidGoldMagikarp` is `Solid` `Gold` `Mag` `ik`
   `arp`, `petertodd` is `pet` `ert` `odd` — and none is a single token in any
   of the nine tokenizer files. Verified twice, independently, with positive
   controls (`Ġbakery`, `Ġthe`, `hello` all resolve, so the lookup was reading
   the vocab). Found by `mrpink`; write-up at
   `internal/glitch-tokenizer-finding_2026-09-06.md`.

   **This refutes the mechanism and says nothing about the feature.** A string
   with no embedding of its own cannot sit at an odd edge of the space, so the
   stated reason cannot operate — `petertodd` being fenced off from random draws
   for a documented negative-valence skew is a property of one GPT-2 token id
   and there is no such id here. But the marks are still unusual strings
   rendered as on-screen text, and whether *that* does anything visible is
   untouched and still a render question. Read as "the marks do nothing" this
   entry is being misread.

   **Settled by the owner: there was never a mechanism to correct.** "Glitch
   token" is a joke name, not a claim about a token id. So the provenance
   sentence in `src/core/creative/glitch.ts` is removed rather than rescoped,
   along with the matching `notInTheGuides` wording — the marks were picked for
   looking wrong on screen, which is a thing a reader can check by looking.

   Worth keeping the shape of how it went wrong, since the code did read as a
   claim whatever was meant: an explanation offered for an effect that did not
   need one, stated without the scope it was true of, is a fact about a
   different model wearing this one's clothes. The effect never depended on it.

   Two limits carried with it. `coderef/` is gitignored, so a clean checkout
   cannot re-derive this and the finding has to carry its own evidence. And it
   can only refute: deriving a genuine under-trained marker set needs embedding
   weights rather than a tokenizer, so this artifact cannot say what a real one
   would be.

   Still open and still needing a render: the marker *spelling* — `<cutoff>`
   and `<scenetrans>` against `<|cutoff|>` — which is a different question from
   the palette and is unaffected by any of the above.

2. **Target local model class.** *Blocked on a measurement this repo cannot take alone.* The prompt-length trade runs opposite ways for
   a small-active MoE and a large dense model. Also settle whether heylook
   reuses the KV prefix across calls.
3. **Whether the schema trailer becomes a plan instance.** *Blocked on a render.* A prompt-quality bet
   with no measurement behind it; same standing as the example block.
4. **How the two projects relate.** Settled by the owner, 2026-09-06, and it
   is smaller than the question was: **the two repos help each other, and that
   is it.** They are not joined at the hip, nothing binds them, neither owes the
   other a boundary, and there is no contract to ratify. Treating it as one was
   my framing and it was wrong.

   The one thing worth keeping written down is not about the relationship but
   about what may be claimed: **the two repos agreeing is consistency, not
   corroboration.** Rules moved between them within hours on the first day of
   sharing, and a commit here called that convergence independent when it was
   not. So a rule that crossed over must not later be cited as two sources
   agreeing. That is claim hygiene, and it holds however loose the collaboration
   is — which is the point, since it is loose by design.
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

## The suite runs from this repo alone

Checked 2026-09-06 rather than assumed: no test reads anything outside the
checkout, none reaches the network, and the only mention of the sister project
anywhere in `test/` is one comment in `test/purity.test.ts`. `contract.test.ts`
reads the guides from `reference/h3/`, which are tracked here and pinned by
sha256. `bun run test` on a clean clone is the whole story.

**Keep it that way, and the two open track B items are where it could go
wrong.** The grader bridge and the paired idea set both involve the sister
project's files, and neither may become something `bun run test` needs. They are
instruments, run by hand, like `scripts/conformance-heylook.mjs` — which already
sets the precedent: nothing in the suite talks to heylook, and that is stated
rather than incidental.

The reason is not tidiness. A suite that needs a second repo cannot be run by
anyone who has only this one, cannot be trusted to mean the same thing on two
machines, and turns another project's commit into this project's red. The two
repos help each other; that is a convenience, and a convenience must not end up
underneath the checks.

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
