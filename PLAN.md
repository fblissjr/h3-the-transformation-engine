# Plan

last updated: 2026-09-01

Working to-do for the planner-prompt and local-model work, and the record of
what is deliberately not being done. Not a roadmap: it is the order the owner
intends to take open questions in, kept in the repo so that the sister project
can read it. Written at `4fb0869`.

## Standing facts this plan rests on

- heylook is the primary backend. Prompt changes are weighed against a local
  model with no constrained decoding and thinking off, not against Gemini.
- heylook's maintainers have said constrained decoding will not be added, so
  the `enforceSchema` A/B is Gemini-only and secondary.
- The only writer-model evidence anywhere is this repo's: one session on a 26B
  MoE, plus two single observations (a 0.8B failed the schema on camera
  amplitude, a 27B dense validated). Nothing has been rendered through H3 from
  a prompt this repo's planner wrote.
- The sister project, ComfyUI-h3-explorations, renders H3 through custom
  ComfyUI nodes and writes its prompts by hand, with Claude, the way this
  repo's own prompts are being reviewed now. It has no local writer model and
  no reason to know what heylook is. Sharing between the two started on
  2026-09-01, on the chance that its test prompts and its prompt research
  overlap with this repo's. It is an authority on the vendor guide hashes, the
  tokenizer config and its graders. Its prompt corpus is not a style source.
- The two repos agreeing is consistency, not corroboration. Rules moved between
  them within hours on the first day of sharing, and a commit here called that
  convergence independent when it was not. The only independent source either
  has is MiniMax's guides and tokenizer config.

## Decisions pending (owner)

1. **Which artifact the compiler targets: the guide text or the release
   tokenizer.** Decides the marker set. This repo writes the guides' `<cutoff>`
   and `<scenetrans>` and requires `<scenetrans>` in both halves of a split
   line. The sister project writes `<|cutoff|>` tight against `</d>`, the form
   the tokenizer declares as one token, and writes no `<scenetrans>` because no
   such token exists. Nobody has rendered either side. Do not move until one
   split line and one truncated line are rendered both ways; that render is
   already on the sister project's own audit list. If the tokenizer wins, the
   spelling becomes a serializer target setting, since the planner currently
   writes the literal into prose.
2. **Target local model class.** The prompt-length trade runs opposite ways
   for a small-active MoE and a large dense model. Name the roster models the
   prompt is tuned against before touching prompt length. Also settle whether
   heylook reuses the KV prefix across calls; the system prompt is stable per
   mode, so if it does, prefill cost mostly disappears.
3. **Whether the schema trailer becomes a plan instance.** The prompt shows the
   vendor's finished output per mode but never the JSON plan that assembles
   into it, and the fixture documents are exactly that plan. A small model
   copies an instance more reliably than it reads a JSON Schema, and the
   schema-echo failure exists only because the schema is in the prompt. Costs
   tokens unless the raw schema is dropped from the trailer. A prompt-quality
   bet with no measurement behind it; same standing as the example block.
4. **Whether the two projects' rule sets stay deliberately separate.**
   Recommended: yes, each traced to the guides and tokenizer independently,
   with only the vendor artifacts as shared truth. Should be a stated decision
   either way.

## To do, in order

- [ ] **Local-model conformance harness.** Generalise
      `scripts/music-lean-heylook.mjs`: a fixed idea set per mode, run through
      each roster model, reporting parse rate, validator diagnostics and
      assembly refusals as separate columns. Answers "which local models hold
      the shape", which `CLAUDE.md` names as the open question on this
      provider. Needs no new app code. Score assembly failures separately from
      prose, or an off-arm defect reads as a verdict on the prompt.
- [ ] **Grader bridge.** A script that writes serialized prompts to a
      directory in the shape the sister project's `bench/grade_prompt_text.py`
      consumes (mode and frame count per file, donor stem for Ref2VA). An
      external mechanical oracle only; it is silent on everything their manual
      tags shown or house, and it cannot see the marker divergence in decision
      1 at all: they ran this repo's `</d> <cutoff>` form through it and it
      passed with no warning. A green from the bridge says nothing about
      markers.
- [ ] **Paired idea set with the sister project.** Use the coverage map from
      their generated prompt bank (unused camera rows, unused Ref2VA task
      types, unused frame counts) as the idea set for the harness, so both
      projects grade the same scenes. Their prompts themselves are not drawn
      from here.
- [ ] **Render the marker question** (decision 1). Cannot be done here; it
      needs their render path.
- [ ] **Re-check the seven wording assertions** in
      `test/creative-integration.test.ts` that the 2026-08-31 test audit
      showed blind to a reworded defect, and either anchor them structurally or
      mark them as wording proxies.
- [ ] **`src/debug/bus.ts`:** the oversized-event replacement carries an
      unbounded key list and is never re-checked against `MAX_EVENT_BYTES`.
      Low reach; it over-evicts rather than throws.
- [ ] After the harness has run once: decide items 2 and 3 above on its
      numbers, not before.

## Not doing

- Adopting the sister project's mouth-cue rule as it stands. Their section
  5.6 (close the mouth when the shot continues past a line) is a house rule
  taken from the vendor's ref example, and it stands; what they withdrew on
  2026-09-01 is only the claim that the shot-final statistic is vendor
  practice. An earlier draft of this file said the whole rule was withdrawn,
  which was wrong. This repo carries the narrower "a held facial state cannot
  survive the line that breaks it" and nothing on lips closing. Whether to add
  the positional form to the planner prompt is a prompt-preference call with
  no render behind it on either side, so it waits with decisions 2 and 3.
- Taking a side on H3 prompt length. The sister project's two length results
  point opposite ways: one Ref2VA pair favoured long with no working control,
  and its T2VA demand pairs predict long worse and are unscored. The Ref2VA
  range in the planner already says not to pad.
- Per-provider `enforceSchema`. Reopens only if a third backend can enforce.
- Treating a local writer model as a shared concern. It is this repo's alone.

## Relayed to the sister project on 2026-09-01

Verified against their tree at `b3823c5` before sending:

- The addressing rule (say who a line is spoken to; a listener takes no id)
  is in both of their derived extracts and not in their manual. The manual's
  only hit is the quoted ref 5.4 example; section 5 has no rule sentence and
  the section 11 ledger has no row. Same lag their section 5.8 confessed for
  singing.
- Their portable system prompt and their manual both route readers to a
  section 15. The manual's last heading is 14. The refs-order contract they
  mean lives at their section 9.6.
- Their section 11 ledger row for camera motion type still says "checked by
  nothing" while their section 13 says a camera-vocabulary check has graded
  every shipped prompt since 2026-08-28. One of the two is stale.
- The split-line render with both cutoff spellings in the same pass was
  proposed from both sides independently before either message was sent, and
  their side has taken it as the first thing to do. It is on their audit list.
  What it can answer is whether each arm meets the brief, not which is better.
- They intend to move the coverage map from their generated bank onto their
  audit list and to use the bank's split-line and truncated-line entries as
  the render's two arms. That covers the ask this file previously carried.
- Corrections taken from their reply: the mouth-cue statement above was
  overstated and is fixed in "Not doing"; a vendor `N/A` percentage in this
  repo's changelog had no derivation and is replaced by the count it came
  from.
