/**
 * Budgets and shot-count guidance derived from duration.
 *
 * These are heuristics and are labelled as such. The hard constraint -- a cut
 * must fall strictly inside the video -- lives in the validator as an error.
 * Everything here produces advice. The beat-density figure is house judgement
 * and not contract: neither guide states a beats-per-second rate, and an
 * earlier version of this comment attributed one to "the guide" that does not
 * exist in either file. Nothing downstream may cite it as a guide rule.
 */

/** A shot needs enough time after its cut to show anything at all. */
export const MIN_SHOT_MS = 1_500;

/**
 * House pacing figure: roughly one dominant beat per 2.5 seconds.
 *
 * Recorded in the contract's notInTheGuides. Neither guide contains "dominant",
 * "density" or any beats-per-second rate; searching for them is the check.
 */
export const MS_PER_BEAT = 2_500;

/**
 * Spoken-word rate used for the dialogue budget.
 *
 * Below natural speech (~3 w/s) on purpose, but calibrated against the guides'
 * own worked examples rather than guessed: the ref-guide's three-line, 18-word
 * exchange runs about eight seconds, and a budget that flagged the official
 * example would have been trained-to-ignore from day one.
 */
export const WORDS_PER_SECOND = 2.5;

/**
 * The last millisecond at which a cut can legally occur.
 *
 * Hard rule: strictly less than the duration. A cut at exactly the final frame
 * introduces a shot with no time in it.
 */
export function latestCutMs(durationSeconds: number): number {
  return Math.max(0, Math.floor(durationSeconds * 1000) - 1);
}

/**
 * The last millisecond at which a cut still leaves a usable shot behind it.
 * Softer than `latestCutMs`; crossing this is a warning, not an error.
 */
export function comfortableLatestCutMs(durationSeconds: number): number {
  return Math.max(0, Math.floor(durationSeconds * 1000) - MIN_SHOT_MS);
}

/**
 * Suggested shot count.
 *
 * Multi-shot is supported and is not a licence to cram unrelated scenes into
 * five seconds, so this stays deliberately low.
 */
export function recommendedShots(durationSeconds: number): number {
  if (durationSeconds <= 5) return 1;
  if (durationSeconds <= 10) return 2;
  if (durationSeconds <= 15) return 3;
  return Math.min(5, Math.floor(durationSeconds / 5));
}

/** Total spoken words the clip can carry without crowding the timeline. */
export function spokenWordBudget(durationSeconds: number): number {
  return Math.floor(durationSeconds * WORDS_PER_SECOND);
}

/** Suggested number of action beats across the clip. */
export function recommendedBeats(durationSeconds: number): number {
  return Math.max(1, Math.round((durationSeconds * 1000) / MS_PER_BEAT));
}

/** Count words the way the budget check does: whitespace-separated tokens. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Sentence count for the two audio sections.
 *
 * Splits on terminal punctuation followed by whitespace or end of string. Good
 * enough for a 1-4 sentence bound; abbreviations would fool it, but the audio
 * sections describe sound and do not contain them.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const matches = trimmed.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!matches) return 1; // no terminal punctuation at all is still one attempt
  const remainder = trimmed.replace(/[^.!?]+[.!?]+(\s|$)/g, '').trim();
  return matches.length + (remainder === '' ? 0 : 1);
}
