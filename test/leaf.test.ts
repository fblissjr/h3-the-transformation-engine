/**
 * The shape gate on the patch surface.
 *
 * The allowlist in `ir/paths.ts` says where a write may land. Until this gate
 * nothing said what may land there, and the hole was live from both directions:
 * the editor committed whatever `Number()` returned for a cut time, and a patch
 * operation carries `value: string`, so a model editing the same field wrote
 * the string. Either way the document saved, serialized and validated clean,
 * and then failed `H3DocumentSchema` on the next load.
 *
 * The shapes are walked out of the document schema rather than restated, so
 * these tests are about the walk reaching the right leaf and the gate acting on
 * what it finds -- not about re-asserting the schema, which owns the rules.
 */

import { describe, expect, it } from 'vitest';
import { applyPatch } from '../src/core/patch/apply';
import { coerceToLeaf, leafSchema } from '../src/core/ir/leaf';
import { PATCHABLE_LEAVES, getAtPath } from '../src/core/ir/paths';
import { t2vaBaker } from './fixtures/guide-examples';

const op = (path: string, value: unknown) => ({
  operations: [{ path, value: value as string, rationale: 'test' }],
  declined: null,
});

describe('leafSchema', () => {
  /**
   * The property, not a sample: an allowlist entry the document schema has no
   * field for would be refused at runtime, so a new leaf that resolves to
   * nothing is a write surface that silently stops working. This is what makes
   * the gate's unresolvable branch unreachable in practice -- it is checked
   * here rather than through `applyPatch`, which cannot reach it while this
   * passes.
   */
  it('resolves every patchable leaf', () => {
    for (const leaf of PATCHABLE_LEAVES) {
      expect(leafSchema(leaf), `${leaf} has no shape`).not.toBeNull();
    }
  });

  it('resolves nothing for a field the schema does not have', () => {
    expect(leafSchema('shots[].invented')).toBeNull();
    expect(leafSchema('nonsense')).toBeNull();
  });

  it('walks through nullable and optional wrappers to reach a leaf', () => {
    // `camera` is nullable and `dialogue` is optional; both have to be seen
    // through to get at the field being written.
    expect(leafSchema('shots[].camera.type')?.safeParse('Push In').success).toBe(true);
    expect(leafSchema('shots[].camera.type')?.safeParse('Zoom Sideways').success).toBe(false);
    expect(leafSchema('shots[].beats[].dialogue.text')?.safeParse('a line').success).toBe(true);
  });

  it('keeps the wrappers on the leaf itself', () => {
    // A null cut time and an absent amplitude are both legal values to write:
    // shot 1 carries no timestamp, and the editor's "medium" option commits
    // undefined.
    expect(leafSchema('shots[].cutAtMs')?.safeParse(null).success).toBe(true);
    expect(leafSchema('shots[].camera.amplitude')?.safeParse(undefined).success).toBe(true);
  });
});

describe('coerceToLeaf', () => {
  it('reads a numeric leaf out of the string a patch operation carries', () => {
    const leaf = leafSchema('shots[].cutAtMs')!;
    expect(coerceToLeaf(leaf, 5000, '6200')).toBe(6200);
  });

  it('leaves an empty string alone rather than making it zero', () => {
    // Number('') is 0. Coercing it here would write a cut at the start of the
    // video for an empty field; left as a string it is refused by the leaf.
    const leaf = leafSchema('shots[].cutAtMs')!;
    expect(coerceToLeaf(leaf, 5000, '')).toBe('');
  });

  it('splits a list leaf, which is how visibleText has always been written', () => {
    const leaf = leafSchema('shots[].beats[].visibleText')!;
    expect(coerceToLeaf(leaf, [], 'OPEN, CLOSED')).toEqual(['OPEN', 'CLOSED']);
  });
});

describe('the shape gate', () => {
  it('applies a legal cut time', () => {
    const result = applyPatch(t2vaBaker, op('shots[1].cutAtMs', 6200));
    expect(result.rejected).toEqual([]);
    expect(getAtPath(result.doc, 'shots[1].cutAtMs')).toBe(6200);
  });

  it('applies a cut time a model sent as text, as a number', () => {
    // The reachable half of this defect: PatchOutputSchema types `value` as a
    // string, so an assisted edit of a numeric field arrives as text and used
    // to be written as text.
    const result = applyPatch(t2vaBaker, op('shots[1].cutAtMs', '6200'));
    expect(result.rejected).toEqual([]);
    expect(getAtPath(result.doc, 'shots[1].cutAtMs')).toBe(6200);
  });

  it('refuses a fractional cut time', () => {
    const result = applyPatch(t2vaBaker, op('shots[1].cutAtMs', 7100.5));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/shots\[\]\.cutAtMs/);
    expect(getAtPath(result.doc, 'shots[1].cutAtMs')).toBe(5000);
  });

  it('refuses a negative cut time', () => {
    // Not merely invalid: `formatTimestamp` throws below zero, so this one used
    // to take `serialize` down inside `editDirect`.
    const result = applyPatch(t2vaBaker, op('shots[1].cutAtMs', -100));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/shots\[\]\.cutAtMs/);
  });

  it('refuses a cut time that is not a number at all', () => {
    const result = applyPatch(t2vaBaker, op('shots[1].cutAtMs', 'soon'));
    expect(result.applied).toEqual([]);
    // Named rather than counted: three other gates also reject, and a count
    // cannot tell you which one spoke.
    expect(result.rejected[0]?.reason).toMatch(/Not a legal value for "shots\[\]\.cutAtMs"/);
  });

  it('refuses a camera move outside the vocabulary', () => {
    const result = applyPatch(t2vaBaker, op('shots[0].camera.type', 'Zoom Sideways'));
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]?.reason).toMatch(/camera\.type/);
  });

  it('refuses to empty a dialogue line the schema requires content in', () => {
    const result = applyPatch(t2vaBaker, op('shots[0].beats[1].dialogue.text', ''));
    expect(result.applied).toEqual([]);
    // The line in this fixture is not user-supplied, so gate 3 is not what
    // rejected it -- assert the shape gate's own message, or a fixture that
    // later flips `userSupplied` would make this pass for the wrong reason.
    expect(result.rejected[0]?.reason).toMatch(/Not a legal value for "shots\[\]\.beats\[\]\.dialogue\.text"/);
  });

  it('still writes prose, which the schema takes as any string', () => {
    const result = applyPatch(t2vaBaker, op('shots[0].beats[0].prose', 'a new sentence.'));
    expect(result.rejected).toEqual([]);
    expect(getAtPath(result.doc, 'shots[0].beats[0].prose')).toBe('a new sentence.');
  });
});
