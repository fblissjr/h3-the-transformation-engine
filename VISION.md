# vision

The north star: what this is and what follows from it. Deliberately short and
deliberately stable.

What it is not: the rules. Invariants, hard rules and the lessons that produced
them live in [CLAUDE.md](./CLAUDE.md), which moves on a faster clock. The output
format lives in [reference/h3/contract.json](./reference/h3/contract.json),
which is bound to the code in both directions. When this document disagrees with
either, they win and this one gets corrected.

## what it is

A prompt compiler and structured editor for MiniMax H3.

Generate a prompt, in any mode, that conforms to the guides. Then edit it like
the structured data it is: a subject has attributes and there may be several; a
shot has beats and there may be several; every one of them is addressable on its
own or all at once.

Nothing here generates video.

## the contract is not up for negotiation

Every value in `vocab.ts` traces to a line in one of the two guides tracked in
[reference/h3/](./reference/h3/). Play happens inside the format, never against
it.

Those two guides are the only authority for what a prompt should say. The
engine's own limits — the frame grid, the duration range — are a different kind
of fact and live in [reference/engine-limits.md](./reference/engine-limits.md),
vendored with their provenance so both can be traced from a clean checkout.

Anything this repo borrows is vendored into it. A reference to a file that only
exists in someone else's checkout is a reference that does not resolve.

## scope is the schema

Global and granular are the same mechanism at different widths. A scope is a set
of document paths, and those paths are the schema fields the prompt is assembled
from:

```
the whole prompt
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
them. There is no separate whole-prompt code path, because a second
implementation of one thing is two things that drift.

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
parse.**

It is a rule someone has to keep rather than a property that holds for free. The
write surface is `PATCHABLE_LEAVES` in `src/core/ir/paths.ts`, an allowlist of
leaves that carry content; a derived field added to it for convenience would
take the guarantee with it. Nothing can decide mechanically whether a new leaf is
derived, so `test/patch.test.ts` pins the list entry for entry.

One entry is a timestamp. `shots[].cutAtMs` is patchable, because where a cut
falls is an editorial decision. What stays derived is its rendering. Aiming a
transform at it can produce a worse edit, never a malformed prompt.

## duration is the budget

Duration decides how much fits, and it governs every other quantity in the
document. Fourteen seconds does not hold twenty seconds of dialogue — it holds
roughly thirty-five words, and asking for more buys skipped words, slurring, or
speech that runs past the end. Shots and action beats work the same way: more of
them in the same span means less of each.

So duration is not one field among the others. It is the constraint the others
are sized against, which is why the compiler works the numbers out and hands
them to the planner as fact — the latest legal cut, a suggested shot count, a
suggested beat count, a spoken-word ceiling — rather than leaving a model to
estimate arithmetic.

The numbers themselves are house estimates and are marked as such wherever they
appear. What is not an estimate is the direction: every one of them tightens as
duration shrinks.

## transforms accumulate

A transform patches the open document. It does not regenerate it.

Regenerating is a slot machine: pull, look, pull again, and nothing you liked
survives the next pull. Patching is a workbench — glitch the audio, keep it,
restyle shot 2, keep that, reroll a prop and undo it because it was worse.
Generate still exists, and it is the right button when you want a different take
rather than a change to this one, but it is the exception.

Every transform lands as an immutable version with a parent pointer, so the
branch you abandoned is still there.

There is no category difference between the transforms that ship and the ones
you type. A transform is an instruction plus a scope; the built-in ones are
instructions someone bothered to name.
