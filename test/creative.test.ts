import { describe, expect, it } from 'vitest';
import { resolve, randomWild } from '../src/core/creative/resolver';
import { scoreStrength, isStressTestViable } from '../src/core/creative/strength';
import { PRESETS, wildPresets } from '../src/core/creative/presets';

describe('Creative Resolver', () => {
  describe('resolve()', () => {
    it('produces a non-empty styleDirective for a basic visual-only selection', () => {
      const injection = resolve({ visual: 'V04', strength: 'subtle' }, 'directed');
      expect(injection.styleDirective).toContain('For the visual medium, use');
      expect(injection.description).toBe('Silhouette cutout');
      expect(injection.mode).toBe('directed');
    });

    it('produces a directive containing all 4 pack names when all 4 are specified', () => {
      const injection = resolve(
        {
          visual: 'V04',
          motion: 'M07',
          finish: 'F07',
          audio: 'A08',
          strength: 'stress-test',
        },
        'directed'
      );

      expect(injection.styleDirective).toContain('silhouette cutout');
      expect(injection.styleDirective).toContain('graphic morphing');
      expect(injection.styleDirective).toContain('print and collage');
      expect(injection.styleDirective).toContain('graphic rhythm bed');
      expect(injection.description).toBe(
        'Silhouette cutout + Graphic morphing + Print and collage + Graphic rhythm bed'
      );
    });

    it('returns the correct mode in the StyleInjection', () => {
      const injection = resolve({ visual: 'V01', strength: 'full' }, 'exploratory');
      expect(injection.mode).toBe('exploratory');
    });

    it('handles anchor IDs (number) as visual selection', () => {
      const injection = resolve({ visual: 3, strength: 'full' }, 'directed');
      expect(injection.styleDirective).toContain('For the visual style, use');
    });
  });

  describe('randomWild()', () => {
    it('returns a valid StyleInjection with mode "wild"', () => {
      const injection = randomWild();
      expect(injection.mode).toBe('wild');
      expect(injection.selection.strength).toBe('stress-test');
    });

    it('returns stress-test strength', () => {
      const injection = randomWild();
      expect(injection.selection.strength).toBe('stress-test');
    });

    it('is deterministic when given a seeded random function', () => {
      const mockRandom1 = () => 0.5;
      const injection1 = randomWild(mockRandom1);

      const mockRandom2 = () => 0.5;
      const injection2 = randomWild(mockRandom2);

      expect(injection1.selection).toEqual(injection2.selection);
    });

    it('falls back to the guaranteed combination when the RNG always returns values that produce non-viable scores', () => {
      // Returning 0 always selects index 0 for all packs.
      // visual[0] is V01 (S, T), motion[0] is M01 (none), finish[0] is F01 (none).
      // Score: S, T (2 axes). This is not stress-test viable (needs >= 3).
      const mockRandom = () => 0;
      const injection = randomWild(mockRandom);

      expect(injection.selection).toEqual({
        visual: 'V04',
        motion: 'M07',
        finish: 'F07',
        audio: 'A08',
        strength: 'stress-test',
      });
    });
  });
});

describe('Creative Strength', () => {
  describe('scoreStrength()', () => {
    it('V04 (silhouette cutout) has G axis', () => {
      const score = scoreStrength({ visual: 'V04' });
      expect(score.G).toBe(true);
      expect(score.S).toBe(true);
    });

    it('V19 (photoreal) has no axes', () => {
      const score = scoreStrength({ visual: 'V19' });
      expect(score.G).toBe(false);
      expect(score.S).toBe(false);
      expect(score.P).toBe(false);
      expect(score.M).toBe(false);
      expect(score.T).toBe(false);
    });

    it('M07 (graphic morphing) has G and M', () => {
      const score = scoreStrength({ motion: 'M07' });
      expect(score.G).toBe(true);
      expect(score.M).toBe(true);
    });

    it('F07 (print collage) has T and P', () => {
      const score = scoreStrength({ finish: 'F07' });
      expect(score.T).toBe(true);
      expect(score.P).toBe(true);
    });

    it('Polymorphic visual: passing a number (AnchorId 3) scores G and S', () => {
      const score = scoreStrength({ visual: 3 });
      expect(score.G).toBe(true);
      expect(score.S).toBe(true);
    });

    it('Combined V04 + M07 + F07 scores >= 3 axes and is stress-test viable', () => {
      const score = scoreStrength({ visual: 'V04', motion: 'M07', finish: 'F07' });
      expect(score.G).toBe(true);
      expect(score.S).toBe(true);
      expect(score.M).toBe(true);
      expect(score.T).toBe(true);
      expect(score.P).toBe(true);
      expect(isStressTestViable(score)).toBe(true);
    });
  });

  describe('isStressTestViable()', () => {
    it('returns true when >= 3 axes with G or S', () => {
      expect(isStressTestViable({ G: true, S: false, P: true, M: true, T: false })).toBe(true);
      expect(isStressTestViable({ G: false, S: true, P: false, M: true, T: true })).toBe(true);
    });

    it('returns false when only T + M (no G or S anchor)', () => {
      expect(isStressTestViable({ G: false, S: false, P: false, M: true, T: true })).toBe(false);
      expect(isStressTestViable({ G: false, S: false, P: true, M: true, T: true })).toBe(false);
    });
  });
});

describe('Creative Presets', () => {
  it('All presets with stress-test strength are actually isStressTestViable when scored', () => {
    for (const preset of PRESETS) {
      if (preset.selection.strength === 'stress-test') {
        const score = scoreStrength(preset.selection);
        expect(isStressTestViable(score), `Preset ${preset.id} should be viable`).toBe(true);
      }
    }
  });

  it('All presets have unique ids', () => {
    const ids = PRESETS.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('wildPresets() returns only stress-test presets', () => {
    const wild = wildPresets();
    expect(wild.length).toBeGreaterThan(0);
    for (const preset of wild) {
      expect(preset.selection.strength).toBe('stress-test');
    }
  });
});
