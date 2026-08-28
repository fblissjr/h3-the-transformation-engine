# vision

The north star: what this is for, and what follows from it. Deliberately short
and deliberately stable.

What it is not: the rules. Invariants, hard rules and the lessons that produced
them live in [CLAUDE.md](./CLAUDE.md), which moves on a faster clock. The output
format lives in [reference/h3/contract.json](./reference/h3/contract.json),
which is bound to the code in both directions. When this document disagrees with
either, they win and this one gets corrected.

## the loop is transform, look, enjoy

Take a prompt. Apply a transform to some part of it, or to all of it. Look at
what changed. Keep it or throw it away.

That is the whole app. Everything else — the document model, the validator, the
version tree, the source map — exists to make that loop fast, legible and
reversible. Nothing here generates video and nothing here is trying to be a
product. It is an instrument for finding out what H3 does when you push on it.

The word that matters is *look*. A transform whose effect you cannot see is not
a transform, it is a setting. Every one of them has to produce a difference you
can point at, in a prompt you can read, next to the version it came from.

## the rigor is what makes the play safe

These look opposed and are not: several hundred tests, a machine-readable
contract, hard rules about controls — and "throw random shit in and see what
happens."

You can only enjoy wrecking something if you know exactly what it was a moment
earlier, and that only the thing you aimed at moved. Byte-exact golden fixtures,
a spec that fails in both directions, patches that name paths and touch nothing
else: that is not ceremony around the fun part. It is the apparatus that makes
the fun part legible. Without it, every result is confounded and nothing you
learn is worth keeping.

So the correctness work is not a tax on the play. It is the thing that turns
messing about into evidence.

## scope is the schema

Global and granular are the same mechanism at different widths. A scope is a set
of document paths, and those paths are the schema fields the prompt is assembled
from:

```
the whole output
├── style                              the opening clause
├── shots[].beats[].prose              what actually conditions the model
├── shots[].beats[].visibleText        on-screen strings
├── shots[].camera.*                   the annotation, not the sentence
├── shots[].cutAtMs                    where the cut falls, not how it renders
├── soundscape
├── music
└── Ref2VA: subjects[].traits, retention[].note, summary
```

"Apply this to the whole prompt" is not a different operation from "apply it to
shot 2." It is the same operation over every eligible field instead of four of
them. Global funnels down to the parts; there is no separate whole-prompt code
path, because a whole-prompt code path would be a second implementation of the
same thing and the two would drift.

Finer than a field is a matter of instruction, not addressing. "Glitch the
character's facial features" aims at `subjects[0].traits` and says which part of
it to touch. The scope stays mechanical; the precision comes from what you ask.

## structure is never a target

A transform can write into fields that carry content. It cannot reach section
labels, `[Shot N]`, the alignment line, `<d>` tags, or anything else the
serializer derives rather than reads. The prompt text is a pure function of the
document, and structure lives on the function side.

This is the guarantee that lets any transform be pointed anywhere: **no
transform, precanned or written by hand, can produce a prompt H3 can no longer
parse.** The mechanism is `PATCHABLE_LEAVES` in `src/core/ir/paths.ts` — the
write surface is an allowlist of leaves that carry content, and structure is
not on it. So this is a rule someone has to keep rather than a property that
holds for free: a derived field added to that list for convenience would take
the guarantee with it. Nothing can decide mechanically whether a new leaf is
derived, so `test/patch.test.ts` pins the list entry for entry instead, and
growing the write surface fails there until someone confirms it was meant.

One entry on the list is a timestamp. `shots[].cutAtMs` is patchable, because
where a cut falls is an editorial decision. What stays derived is its rendering
— the serializer assembles `[Shot 2] At 00:05.000,` from that number, and the
validator holds the number to cuts that are strictly increasing and inside the
video. Aiming a transform at it can produce a worse edit, never a malformed
prompt.

Corrupting the format on purpose, to see how H3 degrades, was considered and
rejected. A prompt the model cannot use teaches nothing, and the appeal was
mine rather than the owner's.

## transforms accumulate

A transform patches the open document. It does not regenerate it.

Regenerating is a slot machine: pull, look, pull again, and nothing you liked
survives the next pull. Patching is a workbench: glitch the audio, keep it,
restyle shot 2, keep that, reroll a prop and undo it because it was worse. Ten
transforms in you are somewhere you steered to rather than somewhere you landed.

Generate still exists, and it is the right button when you want a genuinely
different take rather than a change to this one. But it is the exception, and
the default is that what you approved stays approved until you aim something at
it.

Every transform lands as an immutable version with a parent pointer, so the
branch you abandoned is still there.

## a named transform is a saved instruction

There is no category difference between the transforms that ship and the ones
you type. A transform is an instruction plus a scope; the built-in ones are
instructions someone bothered to name.

This is why named bundles have to earn their place by being used rather than by
sounding good. Fifteen preset pack combinations were deleted for exactly this
reason: they asserted that particular pairings were worth having, and nothing
had ever been checked against real H3 output. A name on an unverified guess is
worse than no name, because it borrows authority the thing has not earned.

## what this means here

- **The contract is not up for negotiation.** Every value in `vocab.ts` traces
  to a line in a guide tracked in `reference/h3/`. Play happens inside the
  format, never against it.
- **A transform is (instruction, scope).** Adding one means adding an
  instruction and saying which field kinds it can target. It does not mean a new
  pipeline.
- **Anything derived stays derived.** If a transform seems to need to edit a
  rendered timestamp or a label, the document model is missing a field — that
  is the same rule that governs the serializer, applied one level out.
- **Deterministic where it can be.** Rerolling a wildcard in place is string
  substitution, not a model call. Seeds are recorded so a result can be had
  again. Spend a call only where judgement is actually required.
- **Every claim gets a control, and a control gets read.** A check is unverified
  until something has shown it reaches its subject, which is a question about
  wiring rather than a ritual: break it where a green could come from never
  arriving, not where the assertion reads the value under test. And a red is
  information about the check, not a pass mark — it can equally mean the check
  encoded a property that only sounded right.
- **Delete freely.** One person, no users, no roadmap. That is a licence to keep
  the code small — and the cost of keeping something that does not earn its
  place is paid on every future change.
