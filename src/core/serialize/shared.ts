/**
 * Pieces both output contracts share: alignment lines, shot headers, dialogue.
 */

import type { Dialogue, H3Document, NormalizedContext, Shot, Speaker } from '../ir/types';
import { ALIGNMENT_TEMPLATES } from '../ir/vocab';
import { formatTimestamp } from '../normalize/duration';

/**
 * Where a beat's dialogue is spliced into its prose.
 *
 * The planner writes complete prose including everything around the line -- the
 * speaker's identifying phrase, the verb, and for voiceover the lips-closed
 * clause that must follow -- and marks the insertion point with this token. The
 * serializer's only job is the substitution, so it never has to guess whether
 * the clause after a quote belongs before or after the tag.
 */
export const DIALOGUE_PLACEHOLDER = '<d/>';

/** Render the `<d>[Language] words</d>` block itself. */
export function renderDialogueTag(d: Dialogue): string {
  return `<d>[${d.language}] ${d.text}</d>`;
}

/**
 * Splice dialogue into prose at the placeholder.
 *
 * A beat that has dialogue but no placeholder is a planner error the validator
 * catches; appending the tag here would paper over it and produce prose whose
 * final clause lands in the wrong place. So the prose is returned untouched and
 * the diagnostic stands.
 */
export function spliceDialogue(prose: string, dialogue: Dialogue | undefined): string {
  if (!dialogue) return prose;
  if (!prose.includes(DIALOGUE_PLACEHOLDER)) return prose;
  return prose.replace(DIALOGUE_PLACEHOLDER, renderDialogueTag(dialogue));
}

/**
 * Rendered speaker id: `(S1)`, or `(S1,S2)` for a chorus. Guide section 4.4.
 *
 * The serializer never calls this -- the planner writes the id into the prose
 * itself, because the guide asks for it inside the sentence. It is the
 * validator that needs the string, to check the prose against the annotation,
 * and it built its own copy until this one was the only one left. The copy
 * sorted the ordinals lexicographically, so ten speakers would have rendered
 * `(S10,S2)`.
 */
export function speakerRef(speaker: Speaker, all: Speaker[]): string | null {
  if (speaker.compoundOf && speaker.compoundOf.length > 0) {
    const ordinals = speaker.compoundOf
      .map((id) => all.find((s) => s.id === id)?.ordinal)
      .filter((o): o is number => o != null)
      .sort((a, b) => a - b);
    // Nothing resolved, so there is no id to render. Returning `()` would have
    // the validator telling the user their prose must contain `()`, on top of
    // the undeclared-member diagnostic that is the actual problem.
    if (ordinals.length === 0) return null;
    return `(${ordinals.map((o) => `S${o}`).join(',')})`;
  }
  return `(S${speaker.ordinal})`;
}

/**
 * The exact opening line for a mode, with `{N}` and `{S.SS}` filled in.
 *
 * T2VA and Ref2VA have none. The other three are fixed strings and the only
 * freedom is the two substitutions -- which is precisely why they are computed
 * here rather than asked for.
 */
export function renderAlignmentLine(doc: H3Document, ctx: NormalizedContext): string | null {
  const template = ALIGNMENT_TEMPLATES[doc.mode];
  if (template == null) return null;
  const finalShot = doc.shots.length;
  return template.replace('{N}', String(finalShot)).replace('{S.SS}', ctx.durationText);
}

/**
 * A shot's opening marker.
 *
 * Shot 1 never carries a timestamp. Later shots open with their cut time; the
 * cut phrasing itself lives in the beat prose, because the guide asks for it as
 * natural language inside the sentence rather than as a detached label.
 */
export function renderShotHeader(shot: Shot): string {
  if (shot.index === 1 || shot.cutAtMs == null) {
    return `[Shot ${shot.index}]`;
  }
  return `[Shot ${shot.index}] At ${formatTimestamp(shot.cutAtMs)},`;
}

/** Join beat prose within a shot, splicing dialogue and collapsing stray spacing. */
export function renderBeats(shot: Shot): string[] {
  return shot.beats.map((beat) => spliceDialogue(beat.prose, beat.dialogue).trim());
}

/**
 * Strip a trailing comma or period from the style clause.
 *
 * The base contract writes the style inline as `[Shot 1] <style>, <prose>`, so a
 * style that already ends in punctuation would produce `cinematic., a medium
 * shot`. Ref2VA writes it as its own sentence and adds the period back.
 */
export function trimStyleTail(style: string): string {
  return style.trim().replace(/[.,;]+$/, '');
}
