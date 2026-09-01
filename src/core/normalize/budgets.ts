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

/**
 * Suggested number of action beats across the clip.
 *
 * `dialogueLines` is a floor, not an adjustment to the density. A beat carries
 * at most one `dialogue` object, so N supplied lines need N beats before any
 * action beat exists at all -- that is a property of the schema rather than a
 * judgement about pacing, which is why it raises the number and never lowers
 * it. MS_PER_BEAT keeps governing everything else.
 *
 * The case it exists for: fast back-and-forth is turn-dense and word-sparse at
 * the same time, so the duration heuristic and the word budget both under-count
 * it while pointing in opposite directions. Eight short turns in fifteen
 * seconds needs eight beats and about seventeen words, against a duration-only
 * suggestion of six beats and a budget of thirty-seven. Without the floor the
 * advice steers toward fewer, longer speeches.
 */
export function recommendedBeats(durationSeconds: number, dialogueLines = 0): number {
  const byDuration = Math.max(1, Math.round((durationSeconds * 1000) / MS_PER_BEAT));
  return Math.max(byDuration, dialogueLines);
}

// Four exports were removed from here: `MIN_SHOT_MS`, `comfortableLatestCutMs`,
// `countWords` and `countSentences`. None had a caller anywhere outside this
// file. `comfortableLatestCutMs` also carried the last written trace of the
// warning severity the validator retired -- "crossing this is a warning, not an
// error" -- which is a rule the repo removed documented as if it were live. The
// sentence ranges it would have checked reach the planner prompt as advice and
// no rule counts them, so nothing was quietly relying on any of it.
