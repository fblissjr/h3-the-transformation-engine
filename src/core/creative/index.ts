/**
 * Creative mode system.
 *
 * A creative mode contributes one thing: a `CreativeModeRecord`, which is a
 * mode, a selection of pack ids, and optionally a set of glitch marks. The
 * directive text and the display label are derived from it wherever they are
 * needed and are never stored.
 *
 * Everything here is pure TypeScript with no browser or network dependencies.
 */

export type {
  Axis,
  PackDef,
  CreativeMode,
  CreativeModeRecord,
  CreativeSelection,
  WritableCreativeMode,
  StoredCreativeRecord,
  StoredSelection,
  StrengthLevel,
  StrengthScore,
  VisualId,
  VisualPackId,
  MotionPackId,
  FinishPackId,
  AudioPackId,
  AnchorId,
  GlitchRegister,
  GlitchSelection,
  GlitchSurfaceDef,
  GlitchSurfaceId,
  GlitchTokenDef,
  GlitchTokenId,
  StoredGlitch,
} from './types';

export { VISUAL_PACKS, MOTION_PACKS, FINISH_PACKS, AUDIO_PACKS } from './packs';
export { STYLE_ANCHORS } from './anchors';
export { VISUAL_SOURCES, getVisual, canonicalVisualId } from './visual';
export { scoreStrength, isStressTestViable } from './strength';
export {
  GLITCH_MAX_TOKENS,
  GLITCH_REGISTERS,
  GLITCH_SURFACES,
  GLITCH_TOKENS,
  DRAWABLE_TOKENS,
  describeGlitch,
  glitchDirective,
  hasGlitch,
  pruneGlitch,
  randomGlitch,
  sameGlitch,
} from './glitch';
export {
  STRENGTH_LEVELS,
  styleDirective,
  describeRecord,
  describeSelection,
  hasDirection,
  hasStyle,
  pruneRecord,
  pruneSelection,
  sameRecord,
  withGlitch,
  sameSelection,
  randomWild,
} from './resolver';
