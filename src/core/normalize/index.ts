/**
 * Deterministic request normalization.
 *
 * Everything computable without a model is computed here: duration, mode,
 * labels, budgets, the latest legal cut. This is the stage that keeps arithmetic
 * and exact strings out of the prompt entirely -- the planner is told the
 * answers rather than asked to derive them.
 */

import type { CompileInput, NormalizedContext } from '../ir/types';
import { contractFor } from '../ir/vocab';
import { formatDuration, framesToSeconds, isOnFrameGrid } from './duration';
import { assignLabels } from './labels';
import { inferMode } from './mode';
import { latestCutMs, recommendedShots, spokenWordBudget } from './budgets';

export * from './duration';
export * from './labels';
export * from './mode';
export * from './budgets';

export class NormalizeError extends Error {}

/**
 * Resolve duration from whichever of frames or seconds was supplied.
 *
 * Frames win when both are present: a frame count is what the workflow actually
 * renders, and the seconds value is then a derived display of it. Neither being
 * present is an error rather than a default, because a silently assumed duration
 * would propagate into the alignment line as a confident wrong number.
 */
function resolveDuration(input: CompileInput): { frames: number | null; seconds: number } {
  if (input.durationFrames != null) {
    if (input.durationFrames <= 0) {
      throw new NormalizeError(`durationFrames must be positive, got ${input.durationFrames}`);
    }
    return { frames: input.durationFrames, seconds: framesToSeconds(input.durationFrames) };
  }
  if (input.durationSeconds != null) {
    if (input.durationSeconds <= 0) {
      throw new NormalizeError(`durationSeconds must be positive, got ${input.durationSeconds}`);
    }
    return { frames: null, seconds: input.durationSeconds };
  }
  throw new NormalizeError('Supply either durationFrames or durationSeconds.');
}

export function normalize(input: CompileInput): NormalizedContext {
  const { frames, seconds } = resolveDuration(input);
  const mode = input.mode ?? inferMode(input.slots).mode;

  return {
    mode,
    contract: contractFor(mode),
    durationFrames: frames,
    durationSeconds: seconds,
    durationText: formatDuration(seconds),
    onFrameGrid: frames == null ? true : isOnFrameGrid(frames),
    latestCutMs: latestCutMs(seconds),
    recommendedShots: recommendedShots(seconds),
    spokenWordBudget: spokenWordBudget(seconds),
    labels: assignLabels(input.slots),
  };
}

/**
 * Rebuild the context from a stored document.
 *
 * Used on every edit: labels and budgets must follow the document's current
 * slots and duration, not whatever they were when it was first generated.
 */
export function contextFor(doc: {
  mode: NormalizedContext['mode'];
  durationFrames: number | null;
  durationSeconds: number;
  slots: CompileInput['slots'];
}): NormalizedContext {
  return {
    mode: doc.mode,
    contract: contractFor(doc.mode),
    durationFrames: doc.durationFrames,
    durationSeconds: doc.durationSeconds,
    durationText: formatDuration(doc.durationSeconds),
    onFrameGrid: doc.durationFrames == null ? true : isOnFrameGrid(doc.durationFrames),
    latestCutMs: latestCutMs(doc.durationSeconds),
    recommendedShots: recommendedShots(doc.durationSeconds),
    spokenWordBudget: spokenWordBudget(doc.durationSeconds),
    labels: assignLabels(doc.slots),
  };
}
