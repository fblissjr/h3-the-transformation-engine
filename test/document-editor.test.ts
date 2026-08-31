/**
 * The cut-time field's commit decision.
 *
 * There is no React renderer in the devDependencies, so the editor itself is
 * unreachable from here: this covers the pure half, which is where both of the
 * defects it guards against live. That the field commits on blur rather than on
 * every keystroke is not asserted here and cannot be -- it was measured in the
 * running app, and the count is recorded next to `CutField`.
 */

import { describe, expect, it } from 'vitest';
import { cutCommit, cutDraft } from '../src/ui/DocumentEditor/DocumentEditor';

describe('cutDraft', () => {
  it('is empty for a shot with no cut time', () => {
    // The regression this exists for: seeding from the displayed `?? 0` put
    // "0" in the field of a shot carrying SHOT_MISSING_TIMESTAMP, so tabbing
    // through it committed a cut at zero and erased the diagnostic. Nothing
    // downstream can tell that write apart from a deliberate one.
    expect(cutDraft(null)).toBe('');
  });

  it('is the number for a shot that has one', () => {
    expect(cutDraft(5200)).toBe('5200');
    expect(cutDraft(0)).toBe('0');
  });

  it('round-trips through cutCommit as no change', () => {
    // The two halves have to agree: a field nobody touched must produce a
    // draft that commits nothing, for every value including zero and null.
    for (const value of [null, 0, 5200]) {
      expect(cutCommit(cutDraft(value), value), `${value} committed itself`).toBeNull();
    }
  });
});

describe('cutCommit', () => {
  it('writes a changed number', () => {
    expect(cutCommit('6300', 5200)).toBe(6300);
  });

  it('writes nothing when the draft is empty', () => {
    // Number('') is 0, so a bare parse turns clearing the field into a cut at
    // the start of the video.
    expect(cutCommit('', 5200)).toBeNull();
    expect(cutCommit('   ', 5200)).toBeNull();
  });

  it('writes nothing when the draft is not a number', () => {
    expect(cutCommit('abc', 5200)).toBeNull();
  });

  it('writes nothing when the value is unchanged', () => {
    // applyPatch rejects an unchanged value with a reason the editor surfaces
    // as an error, so committing one is visible rather than merely wasteful.
    expect(cutCommit('5200', 5200)).toBeNull();
    expect(cutCommit(' 5200 ', 5200)).toBeNull();
  });

  it('writes 0 over a missing cut time', () => {
    // The input displays `cutAtMs ?? 0`; the decision must not. A shot after
    // the first with no cut time is a live SHOT_MISSING_TIMESTAMP, and typing
    // 0 into it is a change even though the field already read 0.
    expect(cutCommit('0', null)).toBe(0);
  });
});
