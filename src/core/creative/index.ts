/**
 * Creative mode system.
 *
 * A creative mode contributes one thing: a `CreativeModeRecord`, which is a
 * mode and a selection of pack ids. The directive text and the display label
 * are derived from it wherever they are needed and are never stored.
 *
 * Everything here is pure TypeScript with no browser or network dependencies.
 */

export type {
  Axis,
  PackDef,
  CreativeMode,
  CreativeModeRecord,
  CreativeSelection,
  StoredSelection,
  StrengthLevel,
  StrengthScore,
  VisualId,
  VisualPackId,
  MotionPackId,
  FinishPackId,
  AudioPackId,
  AnchorId,
} from './types';

export { VISUAL_PACKS, MOTION_PACKS, FINISH_PACKS, AUDIO_PACKS } from './packs';
export { getMotionPack, getFinishPack, getAudioPack } from './packs';
export { STYLE_ANCHORS } from './anchors';
export { VISUAL_SOURCES, getVisual } from './visual';
export { scoreStrength, activeAxes, isStressTestViable } from './strength';
export { styleDirective, describeSelection, hasStyle, randomWild } from './resolver';
export { PRESETS, getPreset, wildPresets } from './presets';
export type { CreativePreset } from './presets';
