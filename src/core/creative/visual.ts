/**
 * The visual id space.
 *
 * A visual selection is either a medium pack (V01-V27) or a reference anchor
 * (R01-R30). They share one id space and one lookup, which is why nothing
 * downstream needs a branch to tell them apart.
 */

import { VISUAL_PACKS, type PackDef, type VisualPackId } from './packs';
import { STYLE_ANCHORS, type AnchorId } from './anchors';

export type VisualId = VisualPackId | AnchorId;

/** Packs first, then anchors -- the order the picker offers them in. */
export const VISUAL_SOURCES: readonly PackDef[] = [...VISUAL_PACKS, ...STYLE_ANCHORS];

const byId: ReadonlyMap<string, PackDef> = new Map(VISUAL_SOURCES.map((v) => [v.id, v]));

/** The id an anchor had before anchors moved into this id space: 28 -> 'R28'. */
export function canonicalVisualId(id: string | number): string {
  return typeof id === 'number' ? `R${String(id).padStart(2, '0')}` : id;
}

/**
 * Takes a bare string or the legacy numeric anchor id on purpose: the argument
 * can come from a stored document written by an older build, so an unknown id
 * has to be a miss rather than a type error nobody is there to see, and a
 * number has to resolve rather than fail.
 */
export function getVisual(id: string | number): PackDef | undefined {
  return byId.get(canonicalVisualId(id));
}
