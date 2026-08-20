/**
 * Creative resolver.
 *
 * Takes a creative selection (pack ids + strength level) and produces a
 * StyleInjection -- a text block ready to splice into the planner's system
 * prompt, plus metadata for the UI and version history.
 *
 * Pure function. No randomness here; the wild-mode randomness lives in
 * `randomWild()` which calls this with a concrete selection.
 */

import type {
  AnchorId,
  CreativeMode,
  CreativeSelection,
  StyleInjection,
  StrengthLevel,
  VisualPackId,
} from './types';
import { getVisualPack, getMotionPack, getFinishPack, getAudioPack } from './packs';
import { getAnchor } from './anchors';

// ---------------------------------------------------------------------------
// Strength preambles
// ---------------------------------------------------------------------------

const STRENGTH_PREAMBLE: Record<StrengthLevel, string> = {
  subtle:
    'Lean toward the following style direction while keeping it grounded. ' +
    'Let the style inform the medium and finish without dominating the scene.',
  full:
    'Commit fully to the following style direction. ' +
    'Apply it consistently across subjects, environment, lighting, and transitions.',
  'stress-test':
    'Push the following style direction as far as it can go. ' +
    'Apply it to every visual layer: subject, crowd, vehicles, architecture, signage, ' +
    'pavement, reflections, atmosphere, smears, and transitions. ' +
    'Use at least 4-6 mutually reinforcing structural descriptors rather than loose adjective clouds.',
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/** Build the style directive text block for the planner system prompt. */
export function resolve(selection: CreativeSelection, mode: CreativeMode): StyleInjection {
  const lines: string[] = ['# Style direction', '', STRENGTH_PREAMBLE[selection.strength]];
  const names: string[] = [];

  // Visual: either a pack or an anchor
  if (typeof selection.visual === 'string') {
    const pack = getVisualPack(selection.visual as VisualPackId);
    if (pack) {
      lines.push('', `For the visual medium, use ${pack.name.toLowerCase()}: ${pack.directive}`);
      names.push(pack.name);
    }
  } else if (typeof selection.visual === 'number') {
    const anchor = getAnchor(selection.visual as AnchorId);
    if (anchor) {
      lines.push('', `For the visual style, use ${anchor.name.toLowerCase()}: ${anchor.directive}`);
      names.push(anchor.name);
    }
  }

  if (selection.motion) {
    const pack = getMotionPack(selection.motion);
    if (pack) {
      lines.push('', `For motion behavior, use ${pack.name.toLowerCase()}: ${pack.directive}`);
      names.push(pack.name);
    }
  }

  if (selection.finish) {
    const pack = getFinishPack(selection.finish);
    if (pack) {
      lines.push('', `For the finish, use ${pack.name.toLowerCase()}: ${pack.directive}`);
      names.push(pack.name);
    }
  }

  if (selection.audio) {
    const pack = getAudioPack(selection.audio);
    if (pack) {
      lines.push('', `For audio treatment, use ${pack.name.toLowerCase()}: ${pack.directive}`);
      names.push(pack.name);
    }
  }

  return {
    styleDirective: lines.join('\n'),
    description: names.join(' + '),
    selection,
    mode,
  };
}

// ---------------------------------------------------------------------------
// Wild mode
// ---------------------------------------------------------------------------

import { VISUAL_PACKS, MOTION_PACKS, FINISH_PACKS, AUDIO_PACKS } from './packs';
import { scoreStrength, isStressTestViable } from './strength';

/**
 * Visual packs with high style leverage (G or S axes).
 *
 * Anchors are excluded from the wild pool: they carry cultural connotations
 * (e.g. "jazz-age rubber-hose") that should be a deliberate choice, not a
 * random draw. Packs are purely technical and combine freely.
 */
const HIGH_LEVERAGE_VISUALS: VisualPackId[] = VISUAL_PACKS
  .filter((p) => {
    const s = scoreStrength({ visual: p.id });
    return s.G || s.S;
  })
  .map((p) => p.id);

/**
 * Generate a random wild selection that is viable for stress-testing.
 *
 * Uses the provided random function for testability. In production, pass
 * `Math.random`. Retries internally if the first draw does not score
 * high enough (capped to avoid infinite loops).
 */
export function randomWild(random: () => number = Math.random): StyleInjection {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];

  for (let attempt = 0; attempt < 20; attempt++) {
    const visual = pick(HIGH_LEVERAGE_VISUALS);
    const motion = pick(MOTION_PACKS).id;
    const finish = pick(FINISH_PACKS).id;
    const audio = pick(AUDIO_PACKS).id;

    const score = scoreStrength({ visual, motion, finish });
    if (isStressTestViable(score)) {
      const selection: CreativeSelection = {
        visual,
        motion,
        finish,
        audio,
        strength: 'stress-test',
      };
      return resolve(selection, 'wild');
    }
  }

  // Fallback: guaranteed high-leverage combination
  const selection: CreativeSelection = {
    visual: 'V04',
    motion: 'M07',
    finish: 'F07',
    audio: 'A08',
    strength: 'stress-test',
  };
  return resolve(selection, 'wild');
}
