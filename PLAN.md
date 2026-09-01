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

- [x] **Local-model conformance harness.** `scripts/conformance-heylook.mjs`,
      done 2026-09-01 and run once; results below. Answers "which local models
      hold the shape", which `CLAUDE.md` names as the open question on this
      provider.
- [ ] **Grader bridge.** A script that writes serialized prompts to a
      directory in the shape the sister project's `bench/grade_prompt_text.py`
      consumes (mode and frame count per file, donor stem for Ref2VA). An
      external mechanical oracle only; it is silent on everything their manual
      tags shown or house, and it cannot see the marker divergence in decision
      1 at all: they ran this repo's `</d> <cutoff>` form through it and it
      passed with no warning. A green from the bridge says nothing about
      markers.
- [ ] **Paired idea set with the sister project.** Their bank is tracked now
      (`prompt_bank/` with `bank.json` naming each prompt's mode, frame count
      and, for Ref2VA, the donor graph; `docs/prompt_bank.md` derives the
      coverage tables). That manifest is the bridge contract: the harness
      should emit the same shape so their grader can read this repo's output
      without a second format. Their prompts themselves are still not drawn
      from here; the scenes and the coverage gaps are what is shared. Their
      generated doc records the two house choices every prompt makes, no
      `<scenetrans>` and the piped tight `<|cutoff|>`, as arguable because this
      repo decides both the other way.
- [ ] **Render the marker question** (decision 1). Cannot be done here; it
      needs their render path. Their audit item 4 now names the bank prompts
      that serve it.
- [ ] **A/B the worked-example block on a weaker model.** With the example in
      the prompt, Qwen3.8-27B wrote its own filled dialogue tag into the prose
      instead of the placeholder on five of eight T2VA ideas and two of four
      in a rerun; with the block stripped, zero of four. DeepSeek never did it
      either way. Four calls is not a decision, and the stripped run also lost
      more speaker ids. Run the eight T2VA ideas both ways at the thinking
      setting the comparison below settles on, and read the placeholder and
      id columns separately.
- [ ] **Decide the thinking default.** Off and medium are measured above;
      xhigh is not, because the backend wedged. Before the xhigh arm is rerun,
      settle what drops a connection past four minutes, or run that arm
      streaming. Off is what the app sends and was never a verdict; medium
      bought schema conformance and nothing at the prose level, at four and a
      half times the time.
- [x] **Re-check the seven wording assertions** in
      `test/creative-integration.test.ts` that the 2026-08-31 test audit
      showed blind to a reworded defect. Done 2026-09-01: the two negative
      assertions are now composition checks (the styled prompt must equal the
      bare prompt plus exactly the derived directive), and the five positive
      ones are marked as wording proxies. A table-derived negative assertion
      was tried first and stayed green against the audit's own mutation,
      because a reworded note matches no table entry either; a negative string
      check cannot see text it does not know.
- [x] **`src/debug/bus.ts`:** the oversized-event replacement's key list is
      bounded in count and length and re-checked against the cap. Done
      2026-09-01. The first version of its test stayed green with the bound
      removed, because the fallback that drops the list satisfied the byte
      assertion; the test now also requires that some keys survive.
- [ ] After the harness has run once: decide items 2 and 3 above on its
      numbers, not before.

## Measured 2026-09-01: two local models through the real pipeline

`scripts/conformance-heylook.mjs`, eleven ideas (eight T2VA covering each
speech feature and on-screen text, three Ref2VA with written descriptions
only), 192 frames, seed 7, thinking off, no constrained decoding, the shipped
prompt with the worked example in it. One run each. Stages are separate
columns and are not summed.

| model | clean | diagnostics | schema | mean s |
|---|---|---|---|---|
| DeepSeek-V4-Flash-0731-UD-IQ4_XS (text only) | 5 | 3 | 3 | 34 |
| unsloth_Qwen3.8-27B-UD-Q8_K_XL (vision) | 2 | 7 | 2 | 48 |

Neither model produced a reply without JSON, a truncation, an assembly refusal
or a provider error. Both hold the shape most of the time; every failure below
is a specific field or a specific rule, which is what the columns are for.

What failed, by cause:

- **`camera.amplitude` outside the enum**, DeepSeek, three of eight T2VA. The
  prompt says medium is expressed by leaving the field out; the model writes a
  value anyway. The received values are being captured in a follow-up run.
  Same field the 0.8B Qwen failed on in the 2026-08-31 note.
- **Speaker id written once, not per beat**, both models. The prompt said
  "write the id in the prose too" and nothing about every line; the validator
  checks every dialogue-carrying beat. Fixed in the prompt the same day.
- **Dialogue placeholder missing**, Qwen, five of eight T2VA. The render shows
  the model's own filled `<d>[English] ...</d>` where the `<d/>` placeholder
  should be, which is exactly what the worked example in the prompt shows.
  DeepSeek did not do this. Whether the example causes it is the A/B in the
  follow-up run: the same four ideas with the example block stripped.
- **`citesSubjects` omitted on one beat**, Qwen, one. A required array that is
  always empty under the base contract.
- **A subject with no sources**, Qwen, one Ref2VA (a voice-only reference). The
  "filling the silence" class the `suppliedFacts` else-branch was written for,
  reached here through a slot that exists but supplies nothing visible.
- **`<scenetrans>` set on beats in a single-shot document**, both models, one
  each: `crossesCut` annotations with no cut to cross.
- **Voiceover phrase and lips-closed sentence missing on the second beat**,
  both models: each wrote the exact phrase on the first voiceover beat and
  paraphrased it on the next.
- **Visible text not quoted**, Qwen, one. The document is stored in the
  follow-up run so the field can be read against the prose.

Two things the validator cannot see and that a reader should. DeepSeek's
"quiet" locksmith scene, with no speech asked for, was given two spoken lines,
and its `non_diegetic_music` for that scene describes a ticking and a whir,
which is ambience under the wrong heading. DeepSeek's cut-off line ends with
an em dash inside the dialogue and no `<cutoff>` tag at all, and validates
clean because `cutoff` was left false; that is a content miss no diagnostic
can name.

**Follow-up the same day.** The amplitude failures were `null`, which the
schema now accepts as absent. Re-running four of the T2VA ideas on Qwen with
the worked-example block stripped from the prompt gave zero placeholder
failures against two of four with it in; four calls, recorded as the reason
for the A/B in the to-do list and not as a result. The fixed seed does not
reproduce: the same idea and seed gave a schema refusal in one run and a clean
document in the next, so every comparison here is between distributions.

**Thinking comparison, stopped before the third arm.** Qwen3.8-27B over the
eight T2VA ideas, `internal/conformance-2026-09-01-thinking.jsonl`.

| arm | clean | diagnostics | schema | provider | placeholder missing | speaker id missing | mean s | mean output tokens |
|---|---|---|---|---|---|---|---|---|
| off | 1 | 5 | 2 | 0 | 4 of 6 | 2 of 6 | 41 | 760 |
| medium | 0 | 7 | 0 | 1 | 4 of 7 | 3 of 7 | 187 | 3588 |
| xhigh | not measured | | | | | | | |

The "of" denominators are the documents that assembled. Medium removed the
schema refusals, cost four and a half times the wall clock, and did not touch
the two prose-level failures: the placeholder and the per-beat id are missed
at the same rate whether the model reasons or not. Two new schema refusals
appeared in the off arm: a speaker ordinal of zero, and a plan with no `style`
field. One-offs, recorded and not fixed. Eight calls an arm on one model.

The xhigh arm produced no document, and why matters for the next run more than
the arm does. Two server behaviours, both from the server log and the client
rows together:

- A generation past roughly four minutes of wall clock returns to this client
  as a fetch failure with no status, while the server log shows it completing
  later (one at 502 seconds, 9,114 tokens). What drops the connection is not
  identified; nothing in the client sets a timeout. Until it is, thinking arms
  need either streaming or a longer-lived connection, and a call that fails
  this way leaves the server generating.
- Once the server is mid-generation on a gguf model, the next request does not
  queue with a 503. It waits on the llama-server subprocess for two minutes and
  returns 500 "unreachable: timed out", which this client reads as the model
  being broken and gives up on. So one dropped connection turned every
  following xhigh call into a provider failure, and the model reports itself
  as loaded again the moment the stray generation ends. That is a heylook
  behaviour worth raising upstream: a busy gguf backend should answer 503 the
  way the MLX path does.

What this does not establish: anything about the prose. Both models write
fluent, specific beats. Whether those beats condition H3 well is the render
question, unchanged.

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

Their reply, same day: all three findings held and are fixed in their
`633e4cd`. The section 15 reference was not a wrong number. A same-day commit
on their side had deleted the whole section while its message said the content
had moved there, so the pointer this repo read as stale was pointing at text
that had been lost; they restored it from the parent commit. The guess that it
meant their section 9.6 was wrong in a way that helped. Their camera-check
ledger now says what the check reaches: amplitude and speed go red, motion
type is warn-only, a novel phrase is caught by neither. Their audit item 4 now
renders the truncated line both ways beside the split line. The coverage map is
still gitignored on their side, so nothing citable exists yet; promoting it is
their owner's call.

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
