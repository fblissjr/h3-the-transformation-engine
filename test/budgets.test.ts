/**
 * Beat and word budgets, and the one place they disagree.
 *
 * These were uncovered entirely until a fast dialogue scene made the gap
 * visible: `recommendedBeats` and `spokenWordBudget` both scale off duration
 * alone, and a rapid exchange is turn-dense and word-sparse at once, so the two
 * heuristics under-count it in opposite directions. Eight short turns in fifteen
 * seconds wants eight beats and about seventeen words; duration alone suggests
 * six beats and a thirty-seven word budget, which steers a planner toward fewer,
 * longer speeches -- the opposite of the register asked for.
 *
 * The floor is the structural half and is the only part taken as a rule. A beat
 * carries at most one `dialogue` object, so N supplied lines need N beats before
 * any action beat exists. That is the schema, not a pacing preference, which is
 * why it raises the count and never lowers it. MS_PER_BEAT is deliberately
 * untouched: one deliberately extreme scene cannot retune a density, and the
 * constant is still right for scenes that are not that one.
 *
 * The prompt-reach assertions are the load-bearing ones. `recommendedBeats` is
 * pure and easy to test in isolation, but the failure this repo keeps repeating
 * is a correct function whose result never arrives -- so the floor is asserted
 * through `buildPlannerSystemPrompt`, at the assembly step where it could go
 * missing silently.
 */

import { describe, expect, it } from 'vitest';

import { normalize } from '../src/core/normalize';
import type { CompileInput } from '../src/core/ir/types';
import { MS_PER_BEAT, recommendedBeats, spokenWordBudget } from '../src/core/normalize/budgets';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';

/** 192 frames is 8.00s at 24fps, and on the 17k+5 grid. */
const base: CompileInput = {
  idea: 'Two people argue on a stairwell landing.',
  mode: 'T2VA',
  durationFrames: 192,
  slots: [],
};

const beatsIn = (prompt: string): number => {
  const m = /Suggested beats: about (\d+)/.exec(prompt);
  return m ? Number(m[1]) : Number.NaN;
};

describe('recommendedBeats', () => {
  it('scales with duration when no dialogue is supplied', () => {
    expect(recommendedBeats(8)).toBe(Math.round(8000 / MS_PER_BEAT));
    expect(recommendedBeats(15)).toBe(Math.round(15000 / MS_PER_BEAT));
  });

  it('never returns less than one beat', () => {
    expect(recommendedBeats(0.1)).toBe(1);
  });

  it('floors at the supplied dialogue count when that is higher', () => {
    // 8s suggests 3 beats; eight turns need eight, one per beat.
    expect(recommendedBeats(8)).toBeLessThan(8);
    expect(recommendedBeats(8, 8)).toBe(8);
  });

  it('leaves the duration figure alone when dialogue is sparser than it', () => {
    // The floor raises and never lowers: two lines in fifteen seconds is still
    // a six-beat scene, not a two-beat one.
    expect(recommendedBeats(15, 2)).toBe(recommendedBeats(15));
  });
});

describe('the dialogue floor reaches the planner prompt', () => {
  // The load-bearing assertion. A pure function returning the right number is
  // worth nothing if `suppliedFacts` does not pass the dialogue count in --
  // which was the state this file was written to fix, and which the whole
  // suite stayed green through.
  it('raises the suggested beats a planner is told to write', () => {
    const withoutDialogue = buildPlannerSystemPrompt(normalize(base), base);
    const eightTurns: CompileInput = {
      ...base,
      suppliedDialogue: [
        'You said tomorrow.',
        'It moved.',
        'To when?',
        'Tonight.',
        'Who else knows?',
        'Nobody.',
        'Keep it that way.',
        'Understood.',
      ],
    };
    const withDialogue = buildPlannerSystemPrompt(normalize(eightTurns), eightTurns);

    expect(beatsIn(withoutDialogue)).toBe(recommendedBeats(8));
    expect(beatsIn(withDialogue), 'eight supplied lines need eight beats').toBe(8);
    expect(beatsIn(withDialogue)).toBeGreaterThan(beatsIn(withoutDialogue));
  });

  it('leaves the suggestion alone when dialogue is sparser than the duration', () => {
    const twoTurns: CompileInput = { ...base, suppliedDialogue: ['You said tomorrow.', 'It moved.'] };
    const prompt = buildPlannerSystemPrompt(normalize(twoTurns), twoTurns);
    expect(beatsIn(prompt)).toBe(recommendedBeats(8));
  });
});

describe('the spoken-word budget is presented as a ceiling', () => {
  /**
   * Wording proxy, and marked as one. There is no rendered shape that
   * distinguishes "write about N words" from "write at most N words" -- the
   * number is identical either way -- so this reads the words. It is here
   * because the failure it guards is real and directional: a budget a model
   * reads as a target gets padded toward, and padding is the one way to spend
   * it wrongly. `MUSIC_SENTENCE_RANGE`'s neighbour rule has the same shape.
   */
  it('says ceiling and not target, and says short is not a shortfall', () => {
    const prompt = buildPlannerSystemPrompt(normalize(base), base);
    const line = prompt.split('\n').find((l) => l.startsWith('Spoken-word budget'));
    expect(line, 'no spoken-word budget line in the prompt').toBeTruthy();
    expect(line).toContain('ceiling and not a target');
    expect(line).toMatch(/not a shortfall/i);
    expect(line).toContain(String(spokenWordBudget(8)));
  });
});
