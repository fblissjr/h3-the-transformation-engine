/**
 * Creative mode system.
 *
 * Injects structured style directives into the planner's system prompt.
 * Everything here is pure TypeScript with no browser or network dependencies.
 */

export type {
  CreativeMode,
  CreativeSelection,
  StyleInjection,
  CreativeModeRecord,
  StrengthLevel,
  StrengthScore,
  VisualPackId,
  MotionPackId,
  FinishPackId,
  AudioPackId,
  AnchorId,
  Pack,
  StyleAnchor,
} from './types';

export { VISUAL_PACKS, MOTION_PACKS, FINISH_PACKS, AUDIO_PACKS } from './packs';
export { getVisualPack, getMotionPack, getFinishPack, getAudioPack } from './packs';
export { STYLE_ANCHORS, getAnchor } from './anchors';
export { scoreStrength, activeAxes, isStressTestViable } from './strength';
export { resolve, randomWild } from './resolver';
export { PRESETS, getPreset, wildPresets } from './presets';
export type { CreativePreset } from './presets';
