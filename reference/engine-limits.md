# Engine limits

The runtime facts about H3 that this repo's duration handling depends on,
vendored here so they can be traced from a clean checkout.

This is not the prompt contract. That is [h3/](./h3/), and the two are different
kinds of claim: the guides are a published specification for what a prompt says,
while everything below is a fact about what the model and the surrounding stack
will accept. Nothing here is quoted from the guides and nothing here constrains
prompt text.

## Why this file exists

These facts were established in a sibling project, `ComfyUI-h3-explorations`,
which is a research and measurement repo for the render side. That project is
not a dependency and is not present in a checkout of this one, so a note in this
repo that pointed at its files would be a dangling reference for anyone who does
not happen to have both. The facts are therefore restated here in full, with
their provenance and their evidentiary standing, and this file is what the code
and [VISION.md](../VISION.md) cite.

That project is authoritative for these facts and for nothing about prompt
style. Its copies of the two MiniMax guides are byte-identical to the ones
pinned in [h3/contract.json](./h3/contract.json), so there is nothing there to
align prompt rules to; its prompt corpus is a research artifact rather than a
model to follow.

## The facts, and what each one rests on

**Frame rate is 24.** H3 generates at a fixed 24 fps and everything it
conditions on is resampled onto that, so a duration and a frame count are the
same statement. `FPS` in `src/core/ir/vocab.ts`.

**Legal frame counts are 17n + 5.** The video VAE encodes 17 pixel frames per
chunk and keeps 5 latents, so a count off that grid cannot be encoded.
`FRAME_BLOCK` and `FRAME_OFFSET` in `src/core/ir/vocab.ts`. This one is
structural and is the firmest fact on the page.

**The duration floor is 5.0 seconds.** From the reference pipeline.

**The duration ceiling is 362 frames, which is 15.083 seconds — and this is a
decision made on thin evidence, not a measurement.** What it rests on: one
upstream statement recorded 2026-08-14 with no artifact attached, plus one
third-party config that ships the value. MiniMax's own README gives a rounded
"4-15 seconds", which neither confirms it nor refutes it, because a product spec
is not a training bound. The official checkpoint configs are silent — no maximum
frame count, no `max_position_embeddings`, and RoPE is theta-based. The owner
weighed that and chose 362.

Record it with that standing attached or not at all. A ceiling quoted as though
it were measured is the guide-number failure this project already has a rule
about.

**The ceiling is expressed in frames rather than seconds on purpose.** No
on-grid count lands on a round 15.0 seconds, so a seconds-first ceiling excludes
its own maximum by 0.083s. 362 is on the grid; 15.0 seconds is not.

**The reference pipeline refuses 362.** `diffusers` hard-codes `max_duration`
at 15.0 and 362 is 15.083s. That is a portability note about one implementation,
not a statement about what H3 accepts, and it should not be called legality.

## What this repo uses, and what it does not

Used: the frame rate and the grid. The duration range is **not** enforced at
either end today — see the two gaps below. This repo is prompt-only, so duration
matters here because it is the budget every other quantity is sized against —
see "duration is the budget" in [VISION.md](../VISION.md).

Deliberately not carried over: aspect-ratio bounds, canvas multiples, and
reference-image encoder sizing. Those are render-side facts with no prompt-side
consequence, and copying them here would create a second place for them to drift
while earning nothing.

## Known gaps, unresolved

Both ends of the duration range are unenforced. Neither is being fixed here,
because both are decisions rather than defects, but neither should stay
undocumented.

**The ceiling is short by one grid step.** `src/ui/App.tsx` builds its duration
picker as `gridFramesUpTo(24 * 15)`, whose largest on-grid value is **345**
frames (14.375s). The ceiling above is 362.

345 is specifically the number the sibling project withdrew: it is the largest
count `diffusers` will emit, which is a fact about `diffusers` rather than about
H3. Arriving at it here by writing `24 * 15` is a coincidence rather than a
citation. Whether to offer the last grid step is a judgement call, and the
evidence for 362 is thin enough that leaving the picker where it is remains
defensible.

**The floor is not applied at all.** `gridFramesUpTo` counts from `k = 0`, so
its first entry is 5 frames — 0.208 seconds. The picker currently offers 21
durations beginning at 0.208s, 0.917s, 1.625s. The documented floor is 5.0
seconds, which is 120 frames; the lowest on-grid count at or above it is 124.

Counted rather than estimated: the picker offers 21 durations, of which **7 fall
below the floor** — 5, 22, 39, 56, 73, 90 and 107 frames, or 0.208s through
4.458s. Fourteen are legal.

This is the same shape as the ceiling gap and was found while writing this file:
a bound that exists in the facts and nowhere in the code, with no test that would
notice. It is a stronger candidate for fixing than the ceiling, because the
ceiling withholds one legal option while the floor offers seven illegal ones — a
third of the menu. Note the one caveat before acting: a single frame is a real H3
mode (image editing) and is the documented exception to the grid, so a floor
applied carelessly would forbid something legitimate — though this repo generates
no video and does not expose that mode.
