/**
 * Style-strength scoring (G/S/P/M/T).
 *
 * Measures how strongly a pack combination will push H3 away from its default
 * photorealism. A combination needs >= 3 axes active, with G or S as an anchor;
 * texture and cadence alone collapse back to the default.
 *
 * The axes live on the pack entries themselves, so this file holds the rule
 * and none of the data. There is no second table here to fall out of step with
 * `packs.ts`.
 *
 * Source: the H3 Prompt Director Shareable Pack, style picker ruleset.
 */

import type { Axis } from './packs';
import { getMotionPack, getFinishPack } from './packs';
import { getVisual } from './visual';
import type { StoredSelection, StrengthScore } from './types';

/** Compute the combined score for a selection. Audio does not participate. */
export function scoreStrength(
  selection: Pick<StoredSelection, 'visual' | 'motion' | 'finish'>,
): StrengthScore {
  const score: StrengthScore = { G: false, S: false, P: false, M: false, T: false };

  const merge = (axes: readonly Axis[] | undefined) => {
    for (const axis of axes ?? []) score[axis] = true;
  };

  if (selection.visual) merge(getVisual(selection.visual)?.axes);
  if (selection.motion) merge(getMotionPack(selection.motion)?.axes);
  if (selection.finish) merge(getFinishPack(selection.finish)?.axes);

  return score;
}

/** Count how many of the 5 axes are active. */
export function activeAxes(score: StrengthScore): number {
  return [score.G, score.S, score.P, score.M, score.T].filter(Boolean).length;
}

/** Whether this combination has enough leverage for a stress-test (>= 3 axes, G or S anchored). */
export function isStressTestViable(score: StrengthScore): boolean {
  return activeAxes(score) >= 3 && (score.G || score.S);
}
