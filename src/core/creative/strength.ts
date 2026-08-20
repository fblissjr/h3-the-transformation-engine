/**
 * Style-strength scoring (G/S/P/M/T).
 *
 * Measures how strongly a pack combination will push H3 away from its default
 * photorealism. A successful stress-test needs >= 3 axes active, with G or S
 * as an anchor. Combinations with only T + cadence collapse.
 *
 * Source: internal/reference_prompting_h3/H3_Prompt_Director_Shareable_Pack_v2_2026-08-13/
 *   10_H3_STYLE_PICKER_RULESET.md
 */

import type { StrengthScore, VisualPackId, MotionPackId, FinishPackId, AnchorId } from './types';

/**
 * Which G/S/P/M/T axes a visual pack activates.
 *
 * Derived from the empirical style-force ladder in the H3 style picker ruleset.
 * Tier A (G) and Tier B (S/P) are highest leverage; Tier C (T) reinforces;
 * Tier D (cadence only) is insufficient alone.
 */
const VISUAL_AXES: Record<VisualPackId, Partial<StrengthScore>> = {
  V01: { S: true, T: true },
  V02: { M: true },
  V03: { S: true, M: true },
  V04: { G: true, S: true },
  V05: { G: true, T: true },
  V06: { G: true, T: true },
  V07: { G: true, T: true },
  V08: { S: true, P: true, T: true },
  V09: { S: true, T: true },
  V10: { S: true, T: true },
  V11: { S: true, P: true },
  V12: { S: true, P: true, T: true },
  V13: { S: true, P: true, T: true },
  V14: { S: true },
  V15: { S: true },
  V16: { S: true, P: true },
  V17: {},
  V18: { S: true, M: true },
  V19: {},
  V20: {},
  V21: {},
  V22: { T: true },
  V23: { S: true },
  V24: {},
};

const MOTION_AXES: Record<MotionPackId, Partial<StrengthScore>> = {
  M01: {},
  M02: { M: true },
  M03: { M: true },
  M04: { M: true },
  M05: {},
  M06: { M: true },
  M07: { G: true, M: true },
  M08: {},
};

const FINISH_AXES: Record<FinishPackId, Partial<StrengthScore>> = {
  F01: {},
  F02: { T: true },
  F03: { T: true },
  F04: { T: true },
  F05: { T: true },
  F06: { T: true },
  F07: { T: true, P: true },
  F08: { P: true },
};

/** Anchors that carry significant geometry or shape leverage. */
const ANCHOR_AXES: Partial<Record<AnchorId, Partial<StrengthScore>>> = {
  1: { T: true },
  3: { G: true, S: true },
  4: { S: true, M: true },
  5: { S: true },
  6: { S: true },
  7: { S: true, M: true },
  9: { S: true, P: true },
  10: { G: true, T: true },
  11: { S: true, P: true, T: true },
  12: { S: true },
  13: { S: true },
  14: { S: true, P: true },
  15: { S: true },
  19: { G: true, T: true },
  20: { S: true, P: true, T: true },
  27: { T: true },
  28: { T: true },
};

/**
 * Compute the combined strength score for a set of packs.
 *
 * `visual` accepts either a VisualPackId (string) or an AnchorId (number),
 * matching the polymorphic shape of `CreativeSelection.visual`.
 */
export function scoreStrength(options: {
  visual?: VisualPackId | AnchorId;
  motion?: MotionPackId;
  finish?: FinishPackId;
}): StrengthScore {
  const score: StrengthScore = { G: false, S: false, P: false, M: false, T: false };

  const merge = (partial: Partial<StrengthScore> | undefined) => {
    if (!partial) return;
    if (partial.G) score.G = true;
    if (partial.S) score.S = true;
    if (partial.P) score.P = true;
    if (partial.M) score.M = true;
    if (partial.T) score.T = true;
  };

  if (options.visual != null) {
    if (typeof options.visual === 'string') merge(VISUAL_AXES[options.visual]);
    else merge(ANCHOR_AXES[options.visual]);
  }
  if (options.motion) merge(MOTION_AXES[options.motion]);
  if (options.finish) merge(FINISH_AXES[options.finish]);

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
