/**
 * The creative mode system.
 *
 * Two things are worth guarding here. The first is that the derivations are
 * total: a selection naming ids nothing recognises has to resolve to nothing
 * rather than to a directive with holes in it, because a stored document can
 * name a pack a later build renamed.
 *
 * The second is that the tables stay in step with each other. The axes now live
 * on the pack entries, so a pack cannot exist without a score, but a pack can
 * still be given the wrong axes -- and the preset viability check is what
 * notices.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIO_PACKS,
  FINISH_PACKS,
  MOTION_PACKS,
  PRESETS,
  STYLE_ANCHORS,
  VISUAL_PACKS,
  VISUAL_SOURCES,
  describeSelection,
  getVisual,
  hasStyle,
  isStressTestViable,
  pruneSelection,
  randomWild,
  scoreStrength,
  styleDirective,
} from '../src/core/creative';

describe('styleDirective', () => {
  it('names the selected pack and carries its traits', () => {
    const text = styleDirective({ visual: 'V04', strength: 'subtle' });
    expect(text).toContain('# Style direction');
    expect(text).toContain('For the visual medium, use silhouette cutout:');
    expect(text).toContain('cutout animation');
  });

  it('includes all four families when all four are chosen', () => {
    const text = styleDirective({
      visual: 'V04',
      motion: 'M07',
      finish: 'F07',
      audio: 'A08',
      strength: 'stress-test',
    });
    expect(text).toContain('silhouette cutout');
    expect(text).toContain('graphic morphing');
    expect(text).toContain('print and collage');
    expect(text).toContain('graphic rhythm bed');
  });

  it('resolves an anchor through the same path as a pack', () => {
    const text = styleDirective({ visual: 'R03', strength: 'full' });
    expect(text).toContain('For the visual medium, use ornate silhouette fantasy:');
  });

  /**
   * The control for the claim above: without the string ids, an anchor and a
   * pack took different branches and only one of them was exercised.
   */
  it('gives an anchor and a pack the same shape of line', () => {
    const pack = styleDirective({ visual: 'V04', strength: 'full' })?.split('\n').at(-1);
    const anchor = styleDirective({ visual: 'R03', strength: 'full' })?.split('\n').at(-1);
    expect(pack?.startsWith('For the visual medium, use ')).toBe(true);
    expect(anchor?.startsWith('For the visual medium, use ')).toBe(true);
  });

  it('states the reach of the strength level it was given', () => {
    expect(styleDirective({ visual: 'V04', strength: 'subtle' })).toContain(
      'sets the medium and the finish',
    );
    expect(styleDirective({ visual: 'V04', strength: 'stress-test' })).toContain(
      '4-6 mutually reinforcing',
    );
  });

  it('is null for an empty selection', () => {
    expect(styleDirective({ strength: 'full' })).toBeNull();
    expect(hasStyle({ strength: 'full' })).toBe(false);
  });

  /**
   * A document written by a build that had a pack this one does not. The style
   * has to fall away quietly; anything else loses the document.
   */
  it('is null when every id is unknown, and drops only the unknown ones otherwise', () => {
    expect(styleDirective({ visual: 'V99', motion: 'M99', strength: 'full' })).toBeNull();

    const partial = styleDirective({ visual: 'V04', motion: 'M99', strength: 'full' });
    expect(partial).toContain('silhouette cutout');
    expect(partial).not.toContain('For motion behavior');
  });

  it('never emits the word undefined, even for a strength level off the union', () => {
    const corrupt = { visual: 'V04', strength: 'extreme' } as never;
    expect(styleDirective(corrupt)).not.toContain('undefined');
  });
});

describe('describeSelection', () => {
  it('joins the names of what resolved', () => {
    expect(describeSelection({ visual: 'V04', motion: 'M07', strength: 'full' })).toBe(
      'Silhouette cutout + Graphic morphing',
    );
  });

  it('is empty when nothing resolved', () => {
    expect(describeSelection({ strength: 'full' })).toBe('');
    expect(describeSelection({ visual: 'V99', strength: 'full' })).toBe('');
  });
});

describe('the pack tables', () => {
  it('carry unique ids across the whole visual id space', () => {
    const ids = VISUAL_SOURCES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('put packs and anchors in one id space, reachable by one lookup', () => {
    for (const entry of [...VISUAL_PACKS, ...STYLE_ANCHORS]) {
      expect(getVisual(entry.id)?.name).toBe(entry.name);
    }
    expect(getVisual('nope')).toBeUndefined();
  });

  it('give every entry a directive and a name', () => {
    for (const entry of [...VISUAL_SOURCES, ...MOTION_PACKS, ...FINISH_PACKS, ...AUDIO_PACKS]) {
      expect(entry.name.length, entry.id).toBeGreaterThan(0);
      expect(entry.directive.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('leave audio out of strength scoring', () => {
    for (const pack of AUDIO_PACKS) expect(pack.axes, pack.id).toEqual([]);
  });
});

describe('scoreStrength', () => {
  it('reads the axes off the pack entry', () => {
    expect(scoreStrength({ visual: 'V04' })).toMatchObject({ G: true, S: true });
    expect(scoreStrength({ motion: 'M07' })).toMatchObject({ G: true, M: true });
    expect(scoreStrength({ finish: 'F07' })).toMatchObject({ T: true, P: true });
  });

  it('scores a photoreal pack at nothing', () => {
    expect(scoreStrength({ visual: 'V19' })).toEqual({
      G: false,
      S: false,
      P: false,
      M: false,
      T: false,
    });
  });

  it('scores an anchor the same way it scores a pack', () => {
    expect(scoreStrength({ visual: 'R03' })).toMatchObject({ G: true, S: true });
  });

  it('unions the axes of a combination', () => {
    const score = scoreStrength({ visual: 'V04', motion: 'M07', finish: 'F07' });
    expect(score).toEqual({ G: true, S: true, P: true, M: true, T: true });
    expect(isStressTestViable(score)).toBe(true);
  });

  it('ignores ids it does not know', () => {
    expect(scoreStrength({ visual: 'V99' })).toMatchObject({ G: false, S: false });
  });
});

describe('isStressTestViable', () => {
  it('needs three axes anchored by G or S', () => {
    expect(isStressTestViable({ G: true, S: false, P: true, M: true, T: false })).toBe(true);
    expect(isStressTestViable({ G: false, S: true, P: false, M: true, T: true })).toBe(true);
  });

  it('refuses texture and cadence without a geometry or shape anchor', () => {
    expect(isStressTestViable({ G: false, S: false, P: false, M: true, T: true })).toBe(false);
    expect(isStressTestViable({ G: false, S: false, P: true, M: true, T: true })).toBe(false);
  });

  it('refuses a G anchor that stands alone', () => {
    expect(isStressTestViable({ G: true, S: false, P: false, M: false, T: false })).toBe(false);
  });
});

describe('randomWild', () => {
  it('draws a stress-test selection', () => {
    const record = randomWild();
    expect(record.mode).toBe('wild');
    expect(record.selection.strength).toBe('stress-test');
    expect(isStressTestViable(scoreStrength(record.selection))).toBe(true);
  });

  it('is a function of the random source it is given', () => {
    expect(randomWild(() => 0.5).selection).toEqual(randomWild(() => 0.5).selection);
  });

  /**
   * Index 0 everywhere is V01 (S, T) + M01 (none) + F01 (none): two axes, not
   * viable. The draw can never succeed, so the fallback is the only way out.
   */
  it('falls back to a known combination when no draw can score', () => {
    expect(randomWild(() => 0).selection).toEqual({
      visual: 'V04',
      motion: 'M07',
      finish: 'F07',
      audio: 'A08',
      strength: 'stress-test',
    });
  });
});

describe('pruneSelection', () => {
  it('keeps everything that resolves', () => {
    const full = { visual: 'V06', motion: 'M04', finish: 'F02', audio: 'A02', strength: 'full' } as const;
    expect(pruneSelection(full)).toEqual(full);
  });

  /**
   * The reason this exists: an id nothing resolves renders as a blank
   * dropdown, and left in the selection it rides along through every later
   * edit without ever being visible.
   */
  it('drops ids nothing resolves, keeping the rest and the strength', () => {
    expect(pruneSelection({ visual: 'V99', motion: 'M04', strength: 'subtle' })).toEqual({
      motion: 'M04',
      strength: 'subtle',
    });
  });

  it('leaves a selection that resolves to nothing at all as just its strength', () => {
    expect(pruneSelection({ visual: 'V99', audio: 'A99', strength: 'full' })).toEqual({
      strength: 'full',
    });
  });
});

describe('presets', () => {
  it('have unique ids', () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('name only ids that exist', () => {
    for (const preset of PRESETS) {
      expect(hasStyle(preset.selection), preset.id).toBe(true);
      expect(describeSelection(preset.selection), preset.id).not.toBe('');
    }
  });

  it('score as viable wherever they claim stress-test strength', () => {
    for (const preset of PRESETS) {
      if (preset.selection.strength !== 'stress-test') continue;
      expect(isStressTestViable(scoreStrength(preset.selection)), preset.id).toBe(true);
    }
  });
});
