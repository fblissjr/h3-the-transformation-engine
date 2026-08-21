/**
 * Selection -> prompt text, and selection -> label.
 *
 * Two pure functions over a `CreativeSelection`. Neither result is stored
 * anywhere: the selection travels, the text is derived at the point of use.
 * That is the same rule the serializer follows, for the same reason -- a
 * derived string kept alongside its input is a string that can disagree with it.
 */

import {
  AUDIO_PACKS,
  FINISH_PACKS,
  MOTION_PACKS,
  VISUAL_PACKS,
  getAudioPack,
  getFinishPack,
  getMotionPack,
} from './packs';
import { canonicalVisualId, getVisual } from './visual';
import { isStressTestViable, scoreStrength } from './strength';
import type {
  CreativeModeRecord,
  CreativeSelection,
  StoredSelection,
  StrengthLevel,
  VisualId,
} from './types';

// ---------------------------------------------------------------------------
// Strength: how far the direction reaches
// ---------------------------------------------------------------------------

/**
 * Each level states its own authority, rather than the core prompt claiming a
 * blanket override. `subtle` that overrode the request would be contradicting
 * its own name.
 */
export const STRENGTH_LEVELS: StrengthLevel[] = ['subtle', 'full', 'stress-test'];

const STRENGTH_PREAMBLE: Record<StrengthLevel, string> = {
  subtle:
    'The direction below sets the medium and the finish. Take everything else -- ' +
    'subject, staging, and action -- from the request, and keep the treatment grounded.',
  full:
    'The direction below governs the look. Where the request describes appearance in passing, ' +
    'the direction wins; the request still decides what happens and to whom. ' +
    'Apply it consistently across subjects, environment, lighting, and transitions.',
  'stress-test':
    'The direction below governs the look, and the request only decides what happens and to whom. ' +
    'Apply it to every visual layer: subject, crowd, vehicles, architecture, signage, pavement, ' +
    'reflections, atmosphere, smears, and transitions. Use at least 4-6 mutually reinforcing ' +
    'structural descriptors rather than loose adjective clouds.',
};

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

interface Line {
  field: 'visual' | 'motion' | 'finish' | 'audio';
  lead: string;
  id: string | undefined;
  lookup: (id: string) => { name: string; directive: string } | undefined;
}

/**
 * The four families in display order, with each id resolved to the form this
 * build uses. The legacy numeric anchor id is normalised here, the one place
 * a selection is taken apart.
 */
function lines(selection: StoredSelection): Line[] {
  return [
    {
      field: 'visual',
      lead: 'For the visual medium, use',
      id: selection.visual == null ? undefined : canonicalVisualId(selection.visual),
      lookup: getVisual,
    },
    { field: 'motion', lead: 'For motion behavior, use', id: selection.motion, lookup: getMotionPack },
    { field: 'finish', lead: 'For the finish, use', id: selection.finish, lookup: getFinishPack },
    { field: 'audio', lead: 'For audio treatment, use', id: selection.audio, lookup: getAudioPack },
  ];
}

/** Resolved entries, in display order, skipping ids nothing knows about. */
function entries(selection: StoredSelection): { lead: string; name: string; directive: string }[] {
  return lines(selection).flatMap(({ lead, id, lookup }) => {
    if (!id) return [];
    const found = lookup(id);
    return found ? [{ lead, name: found.name, directive: found.directive }] : [];
  });
}

/**
 * The text block spliced into a system prompt, or null when the selection
 * resolves to nothing at all -- an empty selection, or one whose ids are all
 * unknown because they were written by an older build.
 */
export function styleDirective(selection: StoredSelection): string | null {
  const resolved = entries(selection);
  if (resolved.length === 0) return null;

  const preamble = STRENGTH_PREAMBLE[selection.strength] ?? STRENGTH_PREAMBLE.full;
  const body = resolved.map((e) => `${e.lead} ${e.name.toLowerCase()}: ${e.directive}`);

  return ['# Style direction', '', preamble, ...body.flatMap((b) => ['', b])].join('\n');
}

/** Whether the selection resolves to anything at all. */
export function hasStyle(selection: StoredSelection): boolean {
  return entries(selection).length > 0;
}

/**
 * Drop what this build cannot resolve, so what is held matches what is shown.
 *
 * A selection restored from a document written by an older build can name a
 * pack this build does not have, or carry an anchor in its old numeric form.
 * The derivations already cope, but left in the selection an unresolvable id
 * renders as a blank dropdown and rides along through every later edit,
 * invisible. Strength is checked for the same reason: a value off the union
 * renders a badge that no strength button matches, and would otherwise be
 * written back into the next document unchanged.
 */
export function pruneSelection(selection: StoredSelection): CreativeSelection {
  const strength = STRENGTH_LEVELS.includes(selection.strength) ? selection.strength : 'full';
  const kept: CreativeSelection = { strength };

  for (const { field, id, lookup } of lines(selection)) {
    if (id && lookup(id)) kept[field] = id as never;
  }
  return kept;
}

/** Whether two selections name the same thing. */
export function sameSelection(a: StoredSelection, b: StoredSelection): boolean {
  const l = lines(a);
  const r = lines(b);
  return a.strength === b.strength && l.every((entry, i) => entry.id === r[i].id);
}

/** Human-readable label for the UI badge and the version history entry. */
export function describeSelection(selection: StoredSelection): string {
  return entries(selection).map((e) => e.name).join(' + ');
}

// ---------------------------------------------------------------------------
// Wild mode
// ---------------------------------------------------------------------------

/**
 * Visual packs with high style leverage (G or S axes).
 *
 * Anchors are excluded from the wild pool: they carry cultural connotations
 * (e.g. "jazz-age rubber-hose") that should be a deliberate choice, not a
 * random draw. Packs are purely technical and combine freely.
 */
const HIGH_LEVERAGE_VISUALS: VisualId[] = VISUAL_PACKS
  .filter((p) => p.axes.some((a) => a === 'G' || a === 'S'))
  .map((p) => p.id);

/**
 * A random selection with enough leverage to be worth a stress-test.
 *
 * Takes the random function so a test can pin it. Retries a bounded number of
 * times, then falls back to a combination known to score.
 */
export function randomWild(random: () => number = Math.random): CreativeModeRecord {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];

  for (let attempt = 0; attempt < 20; attempt++) {
    const selection: CreativeSelection = {
      visual: pick(HIGH_LEVERAGE_VISUALS),
      motion: pick(MOTION_PACKS).id,
      finish: pick(FINISH_PACKS).id,
      audio: pick(AUDIO_PACKS).id,
      strength: 'stress-test',
    };
    if (isStressTestViable(scoreStrength(selection))) return { mode: 'wild', selection };
  }

  return {
    mode: 'wild',
    selection: { visual: 'V04', motion: 'M07', finish: 'F07', audio: 'A08', strength: 'stress-test' },
  };
}
