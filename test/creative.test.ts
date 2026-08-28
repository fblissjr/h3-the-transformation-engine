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
 * still be given the wrong axes. The preset viability check used to be what
 * noticed, by sweeping fifteen four-pack combinations through the scorer; the
 * presets are gone, so `the pack tables` below sweeps the tables themselves.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIO_PACKS,
  DRAWABLE_TOKENS,
  FINISH_PACKS,
  GLITCH_MAX_TOKENS,
  GLITCH_SURFACES,
  GLITCH_TOKENS,
  MOTION_PACKS,
  STYLE_ANCHORS,
  VISUAL_PACKS,
  VISUAL_SOURCES,
  describeGlitch,
  describeRecord,
  describeSelection,
  getVisual,
  glitchDirective,
  hasDirection,
  hasGlitch,
  hasStyle,
  isStressTestViable,
  pruneGlitch,
  pruneRecord,
  withGlitch,
  pruneSelection,
  randomGlitch,
  sameGlitch,
  sameRecord,
  sameSelection,
  randomWild,
  scoreStrength,
  styleDirective,
} from '../src/core/creative';
import type { StoredGlitch } from '../src/core/creative';

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

describe('the legacy numeric anchor id', () => {
  /**
   * The form a document written before anchors had string ids carries. This
   * build renamed them, and the rule is that a rename must not make an older
   * document unopenable or silently strip its style.
   */
  it('resolves to the same anchor as its string id', () => {
    expect(styleDirective({ visual: 28, strength: 'full' })).toBe(
      styleDirective({ visual: 'R28', strength: 'full' }),
    );
    expect(describeSelection({ visual: 3, strength: 'full' })).toBe(
      describeSelection({ visual: 'R03', strength: 'full' }),
    );
  });

  it('scores the same as its string id', () => {
    expect(scoreStrength({ visual: 3 })).toEqual(scoreStrength({ visual: 'R03' }));
  });

  it('is rewritten to the string form when a stored selection is restored', () => {
    expect(pruneSelection({ visual: 28, strength: 'full' })).toEqual({
      visual: 'R28',
      strength: 'full',
    });
  });

  it('still misses when the number names no anchor', () => {
    expect(styleDirective({ visual: 99, strength: 'full' })).toBeNull();
  });
});

describe('sameSelection', () => {
  it('sees through the legacy id form', () => {
    expect(sameSelection({ visual: 28, strength: 'full' }, { visual: 'R28', strength: 'full' })).toBe(true);
  });

  it('separates selections that differ in any field', () => {
    expect(sameSelection({ visual: 'V04', strength: 'full' }, { visual: 'V06', strength: 'full' })).toBe(false);
    expect(sameSelection({ visual: 'V04', strength: 'full' }, { visual: 'V04', strength: 'subtle' })).toBe(false);
    expect(sameSelection({ strength: 'full' }, { strength: 'full' })).toBe(true);
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

  /**
   * Strength reaches the strength buttons and the directive preamble. A value
   * off the union renders a badge no button matches and would be written back
   * into the next document unchanged.
   */
  it('replaces a strength level that is off the union', () => {
    expect(pruneSelection({ visual: 'V04', strength: 'extreme' } as never)).toEqual({
      visual: 'V04',
      strength: 'full',
    });
  });

  it('leaves a selection that resolves to nothing at all as just its strength', () => {
    expect(pruneSelection({ visual: 'V99', audio: 'A99', strength: 'full' })).toEqual({
      strength: 'full',
    });
  });
});

// ---------------------------------------------------------------------------
// Glitch marks
// ---------------------------------------------------------------------------

/**
 * The marks are a second, independent contribution on the same record, and
 * everything guarded for the style selection has to hold for them too: the
 * derivation is total over ids it does not recognise, an empty record is the
 * same state as no record, and the label and the directive come from the one
 * stored value rather than from a copy of the text.
 *
 * The cap is guarded here rather than only in the picker because it is a
 * property of the effect. Four marks stop reading as anomalies.
 */

const ONE: StoredGlitch = { tokens: ['SolidGoldMagikarp'], register: 'motif' };

describe('glitchDirective', () => {
  it('places the marks it was given, spelled exactly and quoted', () => {
    const text = glitchDirective(ONE);
    expect(text).toContain('# Glitch marks');
    expect(text).toContain('"SolidGoldMagikarp"');
    expect(text).toContain('once each');
  });

  it('names the selected surfaces and no others', () => {
    const text = glitchDirective({ ...ONE, surfaces: ['reflection'] });
    expect(text).toContain('Use this surface:');
    expect(text).toContain('Readable only in glass');
    expect(text).not.toContain('Printed on something manufactured');
  });

  /**
   * The surfaces are a pool rather than an assignment. Nothing couples how many
   * are chosen to how many marks there are, so "use these and no others" beside
   * a list of six for a single mark was the block contradicting itself.
   */
  it('offers several surfaces as a pool rather than as one per mark', () => {
    const text = glitchDirective({ ...ONE, surfaces: ['reflection', 'stamp', 'wear'] }) as string;
    expect(text).toContain('a different one for each mark');
    expect(text).not.toContain('and no others');
  });

  it('asks the planner to vary the surface when none was chosen', () => {
    expect(glitchDirective(ONE)).toContain('a different kind of surface');
  });

  /** The marks are visible strings, and the base contract already governs those. */
  it('defers to the on-screen text rule rather than restating it', () => {
    expect(glitchDirective(ONE)).toContain('visibleText');
  });

  /** Every mode note in the planner depends on this holding for all of them. */
  it('keeps a mark out of identity and out of retention, in every mode', () => {
    const text = glitchDirective(ONE) as string;
    expect(text).toContain('out of every subject description');
    expect(text).toContain('out of every retention note');
  });

  it('states a different register for ood than for motif', () => {
    const motif = glitchDirective(ONE) as string;
    const ood = glitchDirective({ ...ONE, register: 'ood' }) as string;
    expect(motif).not.toBe(ood);
    expect(ood).toContain('less expected option');
    expect(motif).toContain('normal register');
  });

  /**
   * The ood register asks for unusual choices, which is the one place this
   * feature could talk the planner out of the rule the whole compiler rests on.
   */
  it('keeps the ood register inside what a camera can record', () => {
    const ood = glitchDirective({ ...ONE, register: 'ood' }) as string;
    expect(ood).toContain('a camera could record');
    expect(ood).toContain('never to abstraction');
  });

  it('is null for a record with no tokens', () => {
    expect(glitchDirective(undefined)).toBeNull();
    expect(glitchDirective({ tokens: [], register: 'motif' })).toBeNull();
  });

  it('is null when every token is one this build does not have', () => {
    expect(glitchDirective({ tokens: ['NotAToken'], register: 'motif' })).toBeNull();
  });

  it('drops only the unknown tokens when some resolve', () => {
    const text = glitchDirective({
      tokens: ['NotAToken', 'PsyNetMessage'],
      register: 'motif',
    }) as string;
    expect(text).toContain('"PsyNetMessage"');
    expect(text).not.toContain('NotAToken');
  });

  it('drops a surface it does not have rather than emitting the id', () => {
    const text = glitchDirective({ ...ONE, surfaces: ['hologram'] }) as string;
    expect(text).not.toContain('hologram');
    expect(text).toContain('a different kind of surface');
  });

  it('never emits the word undefined, even for a register off the union', () => {
    const text = glitchDirective({ ...ONE, register: 'chaos' } as never) as string;
    expect(text).not.toContain('undefined');
    expect(text).toContain('normal register');
  });

  it('places no more marks than the ceiling, however many were given', () => {
    const text = glitchDirective({
      tokens: GLITCH_TOKENS.map((t) => t.id),
      register: 'motif',
    }) as string;
    const placed = GLITCH_TOKENS.filter((t) => text.includes(`"${t.id}"`));
    expect(placed).toHaveLength(GLITCH_MAX_TOKENS);
  });
});

/**
 * Surfaces are chosen independently of marks and nothing caps them against each
 * other, so the directive has to describe whichever way the two counts fall.
 * Asking for "a different one for each mark" beside two surfaces and three
 * marks is an instruction that cannot be followed.
 */
describe('the surface clause matches the counts it was given', () => {
  const three = ['SolidGoldMagikarp', 'GoldMagikarp', 'embedreportprint'];

  it('promises one each only when there are enough', () => {
    const text = glitchDirective({
      tokens: three,
      surfaces: ['inscription', 'reflection', 'stamp'],
      register: 'motif',
    }) as string;
    expect(text).toContain('a different one for each mark');
  });

  it('says so when there are fewer surfaces than marks', () => {
    const text = glitchDirective({
      tokens: three,
      surfaces: ['inscription', 'reflection'],
      register: 'motif',
    }) as string;
    expect(text).toContain('fewer than there are marks');
    expect(text).not.toContain('a different one for each mark');
  });

  it('uses the singular form for one surface', () => {
    const text = glitchDirective({ tokens: three, surfaces: ['wear'], register: 'motif' }) as string;
    expect(text).toContain('Use this surface:');
  });
});

describe('the glitch tables', () => {
  it('carry unique ids', () => {
    const tokens = GLITCH_TOKENS.map((t) => t.id);
    const surfaces = GLITCH_SURFACES.map((s) => s.id);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(new Set(surfaces).size).toBe(surfaces.length);
  });

  it('give every surface a name and a directive', () => {
    for (const surface of GLITCH_SURFACES) {
      expect(surface.name.length, surface.id).toBeGreaterThan(0);
      expect(surface.directive.length, surface.id).toBeGreaterThan(20);
    }
  });

  /** A documented attractor steers a whole scene, so it is a deliberate pick. */
  it('keep the skewed tokens out of the drawable pool and nothing else', () => {
    const skewed = GLITCH_TOKENS.filter((t) => 'skew' in t).map((t) => t.id);
    expect(skewed.length).toBeGreaterThan(0);
    for (const id of skewed) expect(DRAWABLE_TOKENS).not.toContain(id);
    expect(DRAWABLE_TOKENS).toHaveLength(GLITCH_TOKENS.length - skewed.length);
  });

  /**
   * A mark is placed in prose inside double quotes. One containing a quote, a
   * space or a newline would break out of the string it is written into.
   */
  it('name tokens that can be written into quoted prose', () => {
    for (const token of GLITCH_TOKENS) {
      expect(token.id, token.id).toMatch(/^[A-Za-z0-9]+$/);
    }
  });
});

describe('pruneGlitch', () => {
  it('keeps everything that resolves', () => {
    const full: StoredGlitch = {
      tokens: ['SolidGoldMagikarp', 'rawdownload'],
      surfaces: ['inscription', 'wear'],
      register: 'ood',
    };
    expect(pruneGlitch(full)).toEqual(full);
  });

  it('drops tokens and surfaces nothing resolves', () => {
    expect(pruneGlitch({ tokens: ['NotAToken', 'Leilan'], surfaces: ['nope'], register: 'motif' })).toEqual({
      tokens: ['Leilan'],
      register: 'motif',
    });
  });

  /**
   * An empty token list and no record at all have to be one state. Two states
   * that render the same directive are two states the badge can report as
   * different while an edit treats them as the same.
   */
  it('is undefined when nothing survives', () => {
    expect(pruneGlitch(undefined)).toBeUndefined();
    expect(pruneGlitch({ tokens: [], register: 'motif' })).toBeUndefined();
    expect(pruneGlitch({ tokens: ['NotAToken'], register: 'motif' })).toBeUndefined();
  });

  it('replaces a register that is off the union', () => {
    expect(pruneGlitch({ ...ONE, register: 'chaos' } as never)?.register).toBe('motif');
  });

  it('removes a repeated token rather than placing it twice', () => {
    expect(pruneGlitch({ tokens: ['GoldMagikarp', 'GoldMagikarp'], register: 'motif' })?.tokens).toEqual([
      'GoldMagikarp',
    ]);
  });

  it('caps a stored record above the ceiling', () => {
    const tokens = pruneGlitch({ tokens: GLITCH_TOKENS.map((t) => t.id), register: 'motif' })?.tokens;
    expect(tokens).toHaveLength(GLITCH_MAX_TOKENS);
  });
});

describe('sameGlitch and describeGlitch', () => {
  it('sees an unresolvable record and an absent one as the same', () => {
    expect(sameGlitch(undefined, { tokens: ['NotAToken'], register: 'motif' })).toBe(true);
    expect(sameGlitch(undefined, undefined)).toBe(true);
  });

  it('separates records that differ in tokens, surfaces or register', () => {
    expect(sameGlitch(ONE, { tokens: ['GoldMagikarp'], register: 'motif' })).toBe(false);
    expect(sameGlitch(ONE, { ...ONE, register: 'ood' })).toBe(false);
    expect(sameGlitch(ONE, { ...ONE, surfaces: ['wear'] })).toBe(false);
    expect(sameGlitch(ONE, { ...ONE })).toBe(true);
  });

  it('names the marks it resolved, and says when the prose goes with them', () => {
    expect(describeGlitch(ONE)).toBe('glyphs SolidGoldMagikarp');
    expect(describeGlitch({ ...ONE, register: 'ood' })).toBe('OOD glyphs SolidGoldMagikarp');
    expect(describeGlitch({ tokens: ['NotAToken'], register: 'motif' })).toBe('');
  });
});

describe('hasGlitch', () => {
  it('is true only when something resolved', () => {
    expect(hasGlitch(ONE)).toBe(true);
    expect(hasGlitch(undefined)).toBe(false);
    expect(hasGlitch({ tokens: ['NotAToken'], register: 'motif' })).toBe(false);
  });
});

describe('randomGlitch', () => {
  it('draws from the drawable pool only', () => {
    for (let seed = 0; seed < 40; seed++) {
      const drawn = randomGlitch(() => (seed * 0.025) % 1);
      for (const token of drawn.tokens) expect(DRAWABLE_TOKENS).toContain(token);
    }
  });

  it('draws between one and the ceiling, without repeats', () => {
    for (let seed = 0; seed < 40; seed++) {
      const drawn = randomGlitch(() => (seed * 0.025) % 1);
      expect(drawn.tokens.length).toBeGreaterThanOrEqual(1);
      expect(drawn.tokens.length).toBeLessThanOrEqual(GLITCH_MAX_TOKENS);
      expect(new Set(drawn.tokens).size).toBe(drawn.tokens.length);
    }
  });

  it('is a function of the random source it is given', () => {
    expect(randomGlitch(() => 0.42)).toEqual(randomGlitch(() => 0.42));
  });

  /**
   * The draw adds marks; it does not rewrite how every sentence in the clip is
   * worded. That is the larger change of the two and stays a deliberate press.
   */
  it('never draws the ood register', () => {
    for (let seed = 0; seed < 40; seed++) {
      expect(randomGlitch(() => (seed * 0.025) % 1).register).toBe('motif');
    }
  });

  /**
   * The first iteration always pushes, so one mark is guaranteed without a
   * fallback -- one stood in this function unreachable, with a test named for
   * it that passed `() => 0` and took a path where the loop succeeded first
   * time. What the attempt bound actually does is stop a pinned source that
   * keeps drawing the same index from spinning: it comes up short instead.
   */
  it('comes up short rather than spinning when every draw collides', () => {
    // 0.99 lands on the last drawable token every time, so only one is ever
    // reachable however many were wanted.
    const drawn = randomGlitch(() => 0.99);
    expect(drawn.tokens).toHaveLength(1);
    expect(drawn.tokens[0]).toBe(DRAWABLE_TOKENS[DRAWABLE_TOKENS.length - 1]);
    expect(hasGlitch(drawn)).toBe(true);
  });

  it('always yields at least one mark, whatever the source returns', () => {
    for (const value of [0, 0.25, 0.5, 0.75, 0.999999]) {
      expect(randomGlitch(() => value).tokens.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The record as a whole
// ---------------------------------------------------------------------------

/**
 * The reason these exist: a record has two independent halves, and every caller
 * outside the module cares about the pair. A comparison or a gate that reads
 * only the selection is how a marks-only record ends up contributing nothing,
 * or how a change to the marks stays invisible to the badge that reports what
 * an assisted edit will preserve.
 */
describe('the record as a whole', () => {
  const styled = { selection: { visual: 'V06', strength: 'full' } } as const;
  const marked = { selection: { strength: 'full' }, glitch: ONE } as const;

  it('counts a marks-only record as a direction', () => {
    expect(hasStyle(marked.selection)).toBe(false);
    expect(hasDirection(marked)).toBe(true);
    expect(hasDirection({ selection: { strength: 'full' } })).toBe(false);
  });

  it('separates two records that differ only in their marks', () => {
    expect(sameSelection(styled.selection, styled.selection)).toBe(true);
    expect(sameRecord(styled, { ...styled, glitch: ONE })).toBe(false);
    expect(sameRecord(styled, styled)).toBe(true);
  });

  it('labels both halves', () => {
    expect(describeRecord({ ...styled, glitch: ONE })).toBe(
      'Clay animation + glyphs SolidGoldMagikarp',
    );
    expect(describeRecord(marked)).toBe('glyphs SolidGoldMagikarp');
    expect(describeRecord(styled)).toBe('Clay animation');
    expect(describeRecord(null)).toBe('');
  });

  /**
   * The standing check for the class of bug that only a document from the
   * previous build can expose. Records written before marks existed have no
   * glitch key at all, and restoring one must not invent an empty one -- an
   * empty record renders no directive while still comparing as different from
   * absent, which is the badge announcing a change to nothing.
   */
  it('leaves a record written before marks existed exactly as it was', () => {
    const previousBuild = JSON.parse(
      JSON.stringify({ mode: 'directed', selection: { visual: 'V06', strength: 'full' } }),
    );
    const restored = pruneRecord(previousBuild);
    expect(restored).toEqual({ mode: 'directed', selection: { visual: 'V06', strength: 'full' } });
    expect('glitch' in restored).toBe(false);
    expect(sameRecord(restored, previousBuild)).toBe(true);
    expect(describeRecord(restored)).toBe('Clay animation');
  });

  /**
   * The presets are gone and the picker no longer offers the mode they lived
   * in, but documents written under it exist. Refusing to open one, or leaving
   * it holding a mode no button matches, is the regression this repo has
   * already shipped once.
   */
  it('maps the retired preset mode onto what it always was underneath', () => {
    const stored = JSON.parse(
      JSON.stringify({ mode: 'exploratory', selection: { visual: 'V06', strength: 'full' } }),
    );
    const restored = pruneRecord(stored);
    expect(restored.mode).toBe('directed');
    expect(restored.selection).toEqual({ visual: 'V06', strength: 'full' });
    // The mode is not a contribution, so nothing about the style changed.
    expect(sameRecord(restored, stored)).toBe(true);
    expect(describeRecord(restored)).toBe('Clay animation');
  });

  it('prunes both halves, and drops a glitch record that resolves to nothing', () => {
    expect(
      pruneRecord({
        mode: 'directed',
        selection: { visual: 'V99', motion: 'M04', strength: 'full' },
        glitch: { tokens: ['NotAToken'], register: 'motif' },
      }),
    ).toEqual({ mode: 'directed', selection: { motion: 'M04', strength: 'full' } });
  });
});

/**
 * Every axis a pack claims is a real one, and the leverage pool is not empty.
 *
 * This replaces what went with the presets. Their viability sweep incidentally
 * put fifteen four-pack combinations through `scoreStrength`, so a typo'd axis
 * letter turned something red. Deleting them left five hand-picked ids and no
 * table-wide check.
 *
 * Note what is deliberately NOT asserted here: that every pack claims an axis.
 * Nine do not -- V17, V19, V20, V21, V24, M01, M05, M08, F01 -- and that is the
 * point of the scores rather than a gap in them. An empty set means low style
 * leverage, which is how `isStressTestViable` keeps a draw from landing on a
 * combination that reads as a filter. Asserting otherwise was the first version
 * of this test and it went red against nine correct entries, which is the
 * cheapest possible demonstration that a table-wide check needs to encode the
 * property the table actually has.
 */
describe('the axis tables', () => {
  const AXES = new Set(['G', 'S', 'P', 'M', 'T']);
  const styled = [...VISUAL_PACKS, ...MOTION_PACKS, ...FINISH_PACKS, ...AUDIO_PACKS];

  it('claims only documented axes', () => {
    for (const pack of styled) {
      for (const axis of pack.axes) {
        expect(AXES.has(axis), `${pack.id} claims unknown axis "${axis}"`).toBe(true);
      }
    }
  });

  it('never claims the same axis twice', () => {
    for (const pack of styled) {
      expect(new Set(pack.axes).size, `${pack.id} repeats an axis`).toBe(pack.axes.length);
    }
  });

  it('leaves enough leverage in the visual table for a draw to be possible', () => {
    const withLeverage = VISUAL_PACKS.filter(
      (p) => (p.axes as readonly string[]).includes('G') || (p.axes as readonly string[]).includes('S'),
    );
    expect(withLeverage.length).toBeGreaterThan(5);
  });

  it('audio packs carry no visual leverage, on purpose', () => {
    expect(AUDIO_PACKS.every((p) => p.axes.length === 0)).toBe(true);
  });
});

/**
 * The marks survive a change to the style, at the one place that builds a
 * record from a new selection.
 *
 * `withGlitch` exists because this was four hand-written spreads in the
 * creative panel and one of them left the marks out: changing any pack
 * dropdown deleted the selected marks from the record, the badge and the chips
 * in the same render. A UI bug, but the fix is a core function so it can be
 * held here rather than by clicking.
 */
describe('withGlitch', () => {
  const marks: StoredGlitch = { tokens: ['SolidGoldMagikarp'], register: 'motif' };
  const style = { mode: 'directed', selection: { visual: 'V06', strength: 'full' } } as const;

  it('carries marks across a change of style', () => {
    expect(withGlitch(style, marks).glitch?.tokens).toEqual(['SolidGoldMagikarp']);
  });

  it('leaves no key at all when there are no marks', () => {
    expect('glitch' in withGlitch(style, undefined)).toBe(false);
  });

  it('treats an empty token list as no marks, not as an empty set', () => {
    expect('glitch' in withGlitch(style, { tokens: [], register: 'motif' })).toBe(false);
  });

  it('does not disturb the style half', () => {
    const out = withGlitch(style, marks);
    expect(out.mode).toBe('directed');
    expect(out.selection).toEqual(style.selection);
  });
});

/**
 * A mode off the union is a document from a build this one does not know.
 *
 * `loadDocument` reports schema failures rather than gating on them, so an
 * unrecognised mode reaches `pruneRecord`. Left alone it renders a panel with
 * no mode button highlighted and no controls, beside a badge for a style the
 * user can neither see nor edit, and is then written back to the next document
 * unchanged. `pruneSelection` guards `strength` for exactly this reason.
 */
describe('pruneRecord guards the mode', () => {
  const stored = (mode: string) =>
    pruneRecord({ mode, selection: { visual: 'V06', strength: 'full' } } as never);

  it('keeps the two modes this build offers', () => {
    expect(stored('directed').mode).toBe('directed');
    expect(stored('wild').mode).toBe('wild');
  });

  it('maps the retired preset mode onto what it always was underneath', () => {
    expect(stored('exploratory').mode).toBe('directed');
  });

  it('falls back for a mode off the union entirely', () => {
    expect(stored('cinematic').mode).toBe('directed');
    expect(stored('').mode).toBe('directed');
  });
});
