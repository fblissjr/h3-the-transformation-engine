/**
 * Wildcards.
 *
 * Three things are worth guarding. Rolling has to be total over names it does
 * not know, because the placeholder comes out of text the user typed. It has to
 * be a function of the random source, or a seed buys nothing. And the library
 * itself has to hold values the planner is allowed to use: the planner prompt
 * forbids naming what a scene means or how it should feel, so a wildcard that
 * hands it "melancholy" is handing it a word it has been told not to write.
 */

import { describe, expect, it } from 'vitest';
import {
  CATEGORY_IDS,
  MATRIX_CELL_LIMIT,
  WILDCARDS,
  experimentMatrix,
  getCategory,
  hasPlaceholders,
  newSeed,
  placeholdersIn,
  roll,
  rollSeeded,
  seededRandom,
} from '../src/core/wildcards';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe('placeholdersIn', () => {
  it('finds a bare category', () => {
    expect(placeholdersIn('a scene in {setting}.')).toEqual([
      { raw: '{setting}', category: 'setting', count: 1, at: 11 },
    ]);
  });

  it('reads the three modifiers', () => {
    const found = placeholdersIn('{setting:random} {prop:3random} {era:all}');
    expect(found.map((p) => p.count)).toEqual([1, 3, 'all']);
  });

  it('is case-insensitive about the name but reports it lowercased', () => {
    expect(placeholdersIn('{Setting}')[0].category).toBe('setting');
  });

  /** Braces are ordinary punctuation in prose; only a bare name is a placeholder. */
  it('leaves prose in braces alone', () => {
    expect(placeholdersIn('a shot of {} and {two words} and {3} and {a-b}')).toEqual([]);
  });

  it('reports whether there is anything to roll', () => {
    expect(hasPlaceholders('a baker at dawn')).toBe(false);
    expect(hasPlaceholders('a baker in {setting}')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rolling
// ---------------------------------------------------------------------------

describe('roll', () => {
  it('replaces a placeholder with a value from its category', () => {
    const result = roll('a clip set in {setting}.', () => 0);
    expect(result.text).toBe(`a clip set in ${getCategory('setting')!.values[0]}.`);
    expect(result.picks).toEqual([{ category: 'setting', values: [getCategory('setting')!.values[0]] }]);
  });

  it('draws several distinct values and joins them', () => {
    const result = roll('{prop:3random}', seededRandom(7));
    expect(result.picks[0].values).toHaveLength(3);
    expect(new Set(result.picks[0].values).size).toBe(3);
    expect(result.text).toBe(result.picks[0].values.join(', '));
  });

  /** All of them is not a draw: the order is the category's, every time. */
  it('takes the whole category for :all, in its own order', () => {
    for (const random of [() => 0, () => 0.5, seededRandom(9)]) {
      expect(roll('{era:all}', random).picks[0].values).toEqual([...getCategory('era')!.values]);
    }
  });

  /**
   * Asking for more than exists is a request that cannot be met. Distinctness
   * wins over the count, because a value repeated twice reads as a mistake.
   */
  it('never repeats a value, even when more are asked for than exist', () => {
    const result = roll('{era:99random}', seededRandom(3));
    expect(new Set(result.picks[0].values).size).toBe(result.picks[0].values.length);
    expect(result.picks[0].values).toHaveLength(getCategory('era')!.values.length);
  });

  /**
   * The idea is the user's own sentence. Deleting a word out of it because it
   * looked like a category name is worse than leaving something they can see.
   */
  it('leaves a name it does not know exactly where it was, and says so', () => {
    const result = roll('a clip in {nowhere} at {time}.', () => 0);
    expect(result.text).toContain('{nowhere}');
    expect(result.unknown).toEqual(['nowhere']);
    expect(result.picks.map((p) => p.category)).toEqual(['time']);
  });

  it('replaces several placeholders without disturbing each other', () => {
    const result = roll('{subject} {action} in {setting}, {weather}.', seededRandom(11));
    expect(result.text).not.toContain('{');
    expect(result.picks.map((p) => p.category)).toEqual(['subject', 'action', 'setting', 'weather']);
  });

  it('leaves text with nothing to roll untouched', () => {
    const idea = 'A baker opens the shutters before sunrise.';
    expect(roll(idea, () => 0).text).toBe(idea);
  });
});

describe('seeding', () => {
  it('gives the same idea for the same seed', () => {
    const idea = '{subject} {action} in {setting} during {weather}.';
    expect(rollSeeded(idea, 4242).text).toBe(rollSeeded(idea, 4242).text);
  });

  it('gives different ideas for different seeds', () => {
    const idea = '{subject} {action} in {setting} during {weather}.';
    const seeds = [1, 2, 3, 4, 5].map((s) => rollSeeded(idea, s).text);
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it('produces a seed inside the range it advertises', () => {
    expect(newSeed(() => 0)).toBe(0);
    expect(newSeed(() => 0.999999)).toBeLessThan(1_000_000);
  });

  /** A generator that returned a constant would make every seed identical. */
  it('spreads its output across the unit interval', () => {
    const random = seededRandom(99);
    const draws = Array.from({ length: 200 }, random);
    expect(Math.min(...draws)).toBeLessThan(0.2);
    expect(Math.max(...draws)).toBeGreaterThan(0.8);
    expect(new Set(draws).size).toBeGreaterThan(190);
  });
});

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

describe('the wildcard library', () => {
  it('has unique category ids', () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
  });

  it('gives every category values, all distinct within it', () => {
    for (const category of WILDCARDS) {
      expect(category.values.length, category.id).toBeGreaterThan(1);
      expect(new Set(category.values).size, category.id).toBe(category.values.length);
    }
  });

  /**
   * A value is spliced into the middle of the user's sentence, so it cannot
   * carry a capital or a full stop, and it cannot contain a brace or it would
   * parse as a placeholder on the next roll.
   */
  it('holds fragments, not sentences', () => {
    for (const category of WILDCARDS) {
      for (const value of category.values) {
        expect(value, `${category.id}: ${value}`).toBe(value.trim());
        expect(/^[a-z0-9]/.test(value), `${category.id}: ${value}`).toBe(true);
        expect(/[.!?]$/.test(value), `${category.id}: ${value}`).toBe(false);
        expect(value.includes('{') || value.includes('}'), `${category.id}: ${value}`).toBe(false);
      }
    }
  });

  /**
   * The planner prompt says to describe what is visible and audible, never what
   * it means or how the viewer should feel, and the music field rejects mood
   * words by name. A wildcard carrying one hands the planner a word it has been
   * told not to write, and it arrives inside the user's own idea where the
   * style direction cannot override it.
   */
  it('names nothing the planner is forbidden to write', () => {
    const abstractions = [
      'emotional', 'epic', 'moody', 'melancholy', 'nostalgic', 'eerie', 'whimsical',
      'dramatic', 'tense', 'serene', 'joyful', 'mysterious', 'atmospheric', 'haunting',
      'beautiful', 'stunning', 'cinematic feel', 'vibe', 'mood',
    ];
    for (const category of WILDCARDS) {
      for (const value of category.values) {
        const hit = abstractions.find((word) => new RegExp(`\\b${word}\\b`, 'i').test(value));
        expect(hit, `${category.id}: "${value}" names "${hit}"`).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

describe('experimentMatrix', () => {
  it('varies one axis and holds the sentence around it fixed', () => {
    const matrix = experimentMatrix('a baker in {era}.', {});
    expect(matrix.axes.map((a) => a.category)).toEqual(['era']);
    expect(matrix.cells).toHaveLength(getCategory('era')!.values.length);
    for (const cell of matrix.cells) {
      expect(cell.text.startsWith('a baker in ')).toBe(true);
      expect(cell.text.endsWith('.')).toBe(true);
    }
    expect(new Set(matrix.cells.map((c) => c.text)).size).toBe(matrix.cells.length);
  });

  it('takes the product of the axes', () => {
    const matrix = experimentMatrix('{era} {scale}', {
      era: ['the present day', 'the 1930s'],
      scale: ['a handover between two people', 'an interruption to a routine', 'the moment before a decision'],
    });
    expect(matrix.total).toBe(6);
    expect(matrix.cells).toHaveLength(6);
    expect(new Set(matrix.cells.map((c) => c.text)).size).toBe(6);
  });

  it('records which value each cell used, so a result can be attributed', () => {
    const matrix = experimentMatrix('{era}', { era: ['the 1930s'] });
    expect(matrix.cells[0].values).toEqual({ era: 'the 1930s' });
  });

  it('mentions a category only once however often it appears', () => {
    const matrix = experimentMatrix('{era} then {era} again', { era: ['the 1930s', 'the present day'] });
    expect(matrix.axes).toHaveLength(1);
    expect(matrix.cells).toHaveLength(2);
    expect(matrix.cells[0].text).toBe('the 1930s then the 1930s again');
  });

  it('ignores a configured value the category does not have', () => {
    const matrix = experimentMatrix('{era}', { era: ['the 1930s', 'last Tuesday'] });
    expect(matrix.cells).toHaveLength(1);
  });

  it('skips a category it does not know and leaves the placeholder standing', () => {
    const matrix = experimentMatrix('{nowhere} in {era}', { era: ['the 1930s'] });
    expect(matrix.axes.map((a) => a.category)).toEqual(['era']);
    expect(matrix.cells[0].text).toBe('{nowhere} in the 1930s');
  });

  it('is empty for a template with nothing to vary', () => {
    const matrix = experimentMatrix('a baker at dawn.');
    expect(matrix.cells).toEqual([]);
    expect(matrix.total).toBe(0);
    expect(matrix.truncated).toBe(false);
  });

  /** Four axes of the full library is thousands of prompts, not an experiment. */
  it('caps the run and says that it did', () => {
    const matrix = experimentMatrix('{subject} {action} {setting} {prop}');
    expect(matrix.total).toBeGreaterThan(MATRIX_CELL_LIMIT);
    expect(matrix.cells).toHaveLength(MATRIX_CELL_LIMIT);
    expect(matrix.truncated).toBe(true);
  });
});

/**
 * The two buttons have to read the same template the same way.
 *
 * `{prop:3random}` means "put three props here". Rolling did that; the matrix
 * used to hand back one prop per cell, so the same sentence in the same panel
 * meant different things depending on which button was pressed. A placeholder
 * asking for several values is not an axis -- it is a decision the writer has
 * already made, so the matrix draws it once and holds it still.
 */
describe('the matrix and the roll read one template the same way', () => {
  it('holds a multi-draw placeholder fixed instead of varying it', () => {
    const matrix = experimentMatrix('a courier with {prop:3random} in {era}.', {}, 5);
    expect(matrix.axes.map((a) => a.category)).toEqual(['era']);
    expect(matrix.fixed).toHaveLength(1);
    expect(matrix.fixed[0].category).toBe('prop');
    expect(matrix.fixed[0].values).toHaveLength(3);

    const props = matrix.fixed[0].values.join(', ');
    for (const cell of matrix.cells) {
      expect(cell.text).toContain(props);
    }
  });

  it('gives a multi-draw placeholder as many values as a roll would', () => {
    const matrix = experimentMatrix('{prop:3random} in {era}.', {}, 5);
    const rolled = roll('{prop:3random}', seededRandom(5));
    expect(matrix.fixed[0].values).toEqual(rolled.picks[0].values);
  });

  it('expands :all in the sentence rather than turning it into an axis', () => {
    const matrix = experimentMatrix('{era:all} seen from {setting}.', {}, 1);
    expect(matrix.axes.map((a) => a.category)).toEqual(['setting']);
    expect(matrix.fixed[0].values).toHaveLength(getCategory('era')!.values.length);
    expect(matrix.cells[0].text.startsWith(getCategory('era')!.values.join(', '))).toBe(true);
  });

  it('is reproducible: the same seed fixes the same values', () => {
    const a = experimentMatrix('{prop:2random} in {era}.', {}, 77);
    const b = experimentMatrix('{prop:2random} in {era}.', {}, 77);
    expect(a.cells.map((c) => c.text)).toEqual(b.cells.map((c) => c.text));
  });

  it('has nothing fixed when every placeholder is a plain axis', () => {
    expect(experimentMatrix('{era} in {setting}').fixed).toEqual([]);
  });
});
