/**
 * The patch surface.
 *
 * The guarantees under test are the ones that make surgical editing
 * trustworthy: derived values cannot be written, hallucinated paths are refused
 * rather than created, user-supplied dialogue is immutable, and nothing is
 * dropped silently.
 */

import { describe, expect, it } from 'vitest';
import { applyPatch, revertPatch } from '../src/core/patch/apply';
import {
  PATCHABLE_LEAVES,
  getAtPath,
  isPatchable,
  parsePath,
  formatPath,
  setAtPath,
  pathExists,
} from '../src/core/ir/paths';
import { editDirect } from '../src/pipeline';
import { t2vaBaker, i2vaTrain } from './fixtures/guide-examples';

const op = (path: string, value: string) => ({
  operations: [{ path, value, rationale: 'test' }],
  declined: null,
});

describe('path addressing', () => {
  it('round-trips through parse and format', () => {
    const path = 'shots[1].beats[0].dialogue.text';
    expect(formatPath(parsePath(path))).toBe(path);
  });

  it('reads nested values', () => {
    expect(getAtPath(t2vaBaker, 'shots[1].cutAtMs')).toBe(5000);
    expect(getAtPath(t2vaBaker, 'shots[0].beats[1].dialogue.text')).toBe('First batch of the morning.');
  });

  it('distinguishes a missing path from a null value', () => {
    expect(pathExists(t2vaBaker, 'shots[0].cutAtMs')).toBe(true); // exists, value null
    expect(getAtPath(t2vaBaker, 'shots[0].cutAtMs')).toBeNull();
    expect(pathExists(t2vaBaker, 'shots[0].nonsense')).toBe(false);
  });

  it('structurally shares everything off the edited branch', () => {
    const next = setAtPath(t2vaBaker, 'shots[1].cutAtMs', 4000);
    expect(next).not.toBe(t2vaBaker);
    expect(next.shots[1]).not.toBe(t2vaBaker.shots[1]);
    // Untouched siblings keep identity, so React sees a minimal change.
    expect(next.shots[0]).toBe(t2vaBaker.shots[0]);
    expect(next.soundscape).toBe(t2vaBaker.soundscape);
  });

  it('refuses to auto-create a path that does not exist', () => {
    expect(() => setAtPath(t2vaBaker, 'shots[0].invented', 'x')).toThrow(/does not exist/);
  });

  it('refuses an out-of-range array index', () => {
    expect(() => setAtPath(t2vaBaker, 'shots[9].cutAtMs', 1)).toThrow(/out of range/);
  });
});

describe('the patch allowlist', () => {
  it('permits prose and other editable leaves', () => {
    expect(isPatchable('shots[0].beats[1].prose')).toBe(true);
    expect(isPatchable('subjects[2].traits')).toBe(true);
    expect(isPatchable('soundscape')).toBe(true);
  });

  it('refuses derived values', () => {
    // These follow from position and connection order. A model that can write
    // them is a model that can desynchronise the alignment line.
    expect(isPatchable('shots[0].index')).toBe(false);
    expect(isPatchable('subjects[0].ordinal')).toBe(false);
    expect(isPatchable('speakers[0].ordinal')).toBe(false);
    expect(isPatchable('mode')).toBe(false);
    expect(isPatchable('durationSeconds')).toBe(false);
  });
});

describe('applyPatch', () => {
  it('applies an allowed operation and records the before value', () => {
    const result = applyPatch(t2vaBaker, op('soundscape', 'Rain falls on the roof.'));
    expect(result.doc.soundscape).toBe('Rain falls on the roof.');
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0].before).toBe(t2vaBaker.soundscape);
    expect(result.rejected).toEqual([]);
  });

  it('rejects a write to a derived field rather than applying it', () => {
    const result = applyPatch(t2vaBaker, op('shots[0].index', '7'));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/not an editable field/);
    expect(result.doc).toBe(t2vaBaker);
  });

  it('rejects a hallucinated path', () => {
    const result = applyPatch(t2vaBaker, op('shots[4].beats[0].prose', 'nope'));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/does not exist/);
  });

  it('refuses to alter dialogue the user supplied', () => {
    // i2vaTrain's line is marked userSupplied.
    expect(i2vaTrain.shots[0].beats[2].dialogue?.userSupplied).toBe(true);
    const result = applyPatch(i2vaTrain, op('shots[0].beats[2].dialogue.text', 'Something else entirely.'));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/supplied by the user/);
  });

  it('lets the person who supplied a line retype it', () => {
    // The rejection has always said "Edit it directly instead", and until the
    // origin existed that was impossible: a typed edit goes through this same
    // function and hit the same gate. The gate protects the line from the
    // model, which is the whole of its purpose.
    const result = applyPatch(
      i2vaTrain,
      op('shots[0].beats[2].dialogue.text', 'What I actually said.'),
      'direct',
    );
    expect(result.rejected).toEqual([]);
    expect(getAtPath(result.doc, 'shots[0].beats[2].dialogue.text')).toBe('What I actually said.');
  });

  it('still refuses the same edit when it comes from a model', () => {
    // The default origin is the untrusted one, so a caller that says nothing
    // gets the protection rather than losing it.
    const result = applyPatch(i2vaTrain, op('shots[0].beats[2].dialogue.text', 'Something else.'));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/supplied by the user/);
  });

  it('allows editing dialogue the model wrote', () => {
    expect(t2vaBaker.shots[0].beats[1].dialogue?.userSupplied).toBe(false);
    const result = applyPatch(t2vaBaker, op('shots[0].beats[1].dialogue.text', 'Last batch of the night.'));
    expect(result.applied).toHaveLength(1);
  });

  it('reports a no-op instead of counting it as applied', () => {
    const result = applyPatch(t2vaBaker, op('soundscape', t2vaBaker.soundscape));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/unchanged/);
  });

  it('coerces a list value rather than changing the field type', () => {
    const result = applyPatch(t2vaBaker, op('shots[0].beats[0].visibleText', 'OPEN, CLOSED'));
    expect(result.doc.shots[0].beats[0].visibleText).toEqual(['OPEN', 'CLOSED']);
  });

  it('applies the good operations and reports the bad ones from the same patch', () => {
    const result = applyPatch(t2vaBaker, {
      operations: [
        { path: 'soundscape', value: 'A door closes.', rationale: 'ok' },
        { path: 'shots[0].index', value: '3', rationale: 'not allowed' },
        { path: 'music', value: 'A single sustained cello note.', rationale: 'ok' },
      ],
      declined: null,
    });
    expect(result.applied.map((a) => a.path)).toEqual(['soundscape', 'music']);
    expect(result.rejected.map((r) => r.path)).toEqual(['shots[0].index']);
  });

  it('passes through what the model declined to do', () => {
    const result = applyPatch(t2vaBaker, {
      operations: [{ path: 'soundscape', value: 'Wind.', rationale: 'ok' }],
      declined: [{ what: 'add a fourth shot', why: 'structural change, not a patch' }],
    });
    expect(result.declined).toHaveLength(1);
  });

  it('reverts cleanly', () => {
    const result = applyPatch(t2vaBaker, op('soundscape', 'Changed.'));
    expect(revertPatch(result.doc, result.applied)).toEqual(t2vaBaker);
  });
});

describe('direct edits go through the same gates', () => {
  it('re-renders and re-validates after a manual field change', () => {
    const result = editDirect(t2vaBaker, 'shots[1].cutAtMs', 3000);
    expect(result.doc.shots[1].cutAtMs).toBe(3000);
    expect(result.rendered.text).toContain('[Shot 2] At 00:03.000,');
    expect(result.validation.ok).toBe(true);
  });

  it('surfaces a validation error introduced by the edit instead of hiding it', () => {
    const result = editDirect(t2vaBaker, 'shots[1].cutAtMs', 99_000);
    expect(result.validation.diagnostics.map((d) => d.code)).toContain('CUT_OUTSIDE_DURATION');
  });
});

/**
 * The write surface is pinned, because the guarantee rests on it.
 *
 * VISION.md's claim that no transform can produce a prompt H3 cannot parse is
 * true only while structure stays off `PATCHABLE_LEAVES`. The assertions above
 * name five paths that must be rejected, which is a proxy: adding a sixth
 * derived field to the allowlist passes every one of them. Nothing can tell
 * mechanically whether a new entry is derived, so this pins the list instead --
 * the same move the contract makes with the guides' sha256, and for the same
 * reason. Growing the surface is then a deliberate, visible event rather than a
 * silent one, and whoever adds a line has to come here and say it was meant.
 *
 * A failure here is not necessarily a bug. It is a question: is the new leaf
 * something the serializer derives?
 *
 * Pinning is right here and is not right everywhere. The condition is not that
 * the list is small -- it is that the pin catches the direction of change that
 * is dangerous. This list GRANTS write access, so growth is the harmful
 * direction and a pin fires exactly there. A list that RESTRICTS -- a denylist
 * of phrases, say -- is the mirror: growth means somebody found another bad
 * case and the check got stronger, shrinkage is the silent loss, and a strict
 * pin would fail on every legitimate addition until someone deleted it. Both
 * are "a list of strings the code compares against" and the shape does not tell
 * you which you have. Ask which edit you are afraid of first.
 *
 * The separation is load-bearing too: the list lives in `src/core/ir/paths.ts`
 * and this copy is written by hand here, so granting access and acknowledging
 * it cannot be the same edit. A baseline sitting beside the list it guards is a
 * speed bump rather than a control -- whoever changes one changes both.
 */
describe('the patchable surface', () => {
  it('is exactly this list', () => {
    // Sorted on both sides: reordering the source list changes nothing about
    // what is writable, and a pin that fails on tidying is one that gets
    // deleted. Growth is the direction this exists to catch.
    expect([...PATCHABLE_LEAVES].sort()).toEqual(
      [
      'style',
      'soundscape',
      'music',
      'summary',
      'shots[].beats[].prose',
      'shots[].beats[].visibleText',
      'shots[].beats[].dialogue.text',
      'shots[].beats[].dialogue.language',
      'shots[].camera.type',
      'shots[].camera.amplitude',
      'shots[].camera.speed',
      'shots[].cutAtMs',
      'subjects[].traits',
      'subjects[].retention',
      'subjects[].retentionNote',
      'speakers[].descriptor',
      'retention[].marker',
      'retention[].note',
      'slots[].description',
      ].sort(),
    );
  });

  it('carries no path the serializer derives its structure from', () => {
    // Not a proof -- see the note above. These are the derived families that
    // exist today, checked as patterns so a new index or ordinal is caught.
    for (const leaf of PATCHABLE_LEAVES) {
      expect(leaf, `${leaf} looks derived`).not.toMatch(/\.(index|ordinal|id)$/);
    }
  });
});
