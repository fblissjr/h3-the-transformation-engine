/**
 * Reference label assignment.
 *
 * Labels are always derived from connection order and role, never stored and
 * never typed by a user or a model. Two rules from the ref guide drive the whole
 * function and are easy to get subtly wrong:
 *
 *  1. Picture, Video and Audio are numbered INDEPENDENTLY. The same source video
 *     is legitimately <Video 1> and <Audio 2>; the differing indices do not mean
 *     they came from different files.
 *
 *  2. An image used only to define a character, scene, costume, or style does
 *     NOT get a standalone <Picture N> entry -- it is cited inside the
 *     corresponding <Subject N>. It still consumes a Picture ordinal, because
 *     the label has to exist in order to be cited.
 */

import type { ReferenceSlot, SlotLabel } from '../ir/types';
import { AUDIO_ROLES, FRAME_ANCHOR_ROLES, SLOT_CEILINGS, VIDEO_STRUCTURE_ROLES } from '../ir/vocab';
import type { MediaKind } from '../ir/vocab';

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return roles.some((r) => wanted.includes(r));
}

/**
 * Assign every label each slot carries.
 *
 * A slot usually yields one label. A reference video whose soundtrack is
 * actually used yields two: a <Video N> for the visual/structural relationship
 * and an <Audio N> for the sound. A video that merely happens to contain sound
 * does not -- the ref guide is explicit that an ordinary reference video does
 * not create an Audio label just because the file has an audio track.
 */
export function assignLabels(slots: ReferenceSlot[]): SlotLabel[] {
  const ordered = [...slots].sort((a, b) => a.order - b.order);
  const counters: Record<'Picture' | 'Video' | 'Audio', number> = {
    Picture: 0,
    Video: 0,
    Audio: 0,
  };
  const labels: SlotLabel[] = [];

  for (const slot of ordered) {
    if (slot.kind === 'image') {
      counters.Picture += 1;
      labels.push({
        slotId: slot.id,
        kind: 'Picture',
        ordinal: counters.Picture,
        ref: `<Picture ${counters.Picture}>`,
        standalone: hasAny(slot.roles, FRAME_ANCHOR_ROLES),
      });
      continue;
    }

    if (slot.kind === 'video') {
      counters.Video += 1;
      labels.push({
        slotId: slot.id,
        kind: 'Video',
        ordinal: counters.Video,
        ref: `<Video ${counters.Video}>`,
        // <Video N> is reserved for whole-video relationships: editing,
        // continuation, or a structural reference to camera, cuts, rhythm or
        // timing. A video that merely supplies a person, object or action is
        // reusable visible content and belongs under a <Subject N> instead, so
        // it consumes an ordinal but earns no standalone definition line.
        standalone: hasAny(slot.roles, VIDEO_STRUCTURE_ROLES),
      });
      // Only when the soundtrack is actually given a job.
      if (hasAny(slot.roles, AUDIO_ROLES)) {
        counters.Audio += 1;
        labels.push({
          slotId: slot.id,
          kind: 'Audio',
          ordinal: counters.Audio,
          ref: `<Audio ${counters.Audio}>`,
          standalone: true,
        });
      }
      continue;
    }

    counters.Audio += 1;
    labels.push({
      slotId: slot.id,
      kind: 'Audio',
      ordinal: counters.Audio,
      ref: `<Audio ${counters.Audio}>`,
      standalone: true,
    });
  }

  return labels;
}

/** Every label belonging to one slot. A video with a used soundtrack has two. */
export function labelsForSlot(labels: SlotLabel[], slotId: string): SlotLabel[] {
  return labels.filter((l) => l.slotId === slotId);
}

/** The primary (visual, or sole) label for a slot. */
export function primaryLabel(labels: SlotLabel[], slotId: string): SlotLabel | undefined {
  const own = labelsForSlot(labels, slotId);
  return own.find((l) => l.kind !== 'Audio') ?? own[0];
}

/** How many slots of each media kind are attached. */
export function countByKind(slots: ReferenceSlot[]): Record<MediaKind, number> {
  return slots.reduce<Record<MediaKind, number>>(
    (acc, s) => {
      acc[s.kind] += 1;
      return acc;
    },
    { image: 0, video: 0, audio: 0 },
  );
}

/** Media kinds attached beyond their documented ceiling. */
export function ceilingViolations(slots: ReferenceSlot[]): { kind: MediaKind; count: number; max: number }[] {
  const counts = countByKind(slots);
  return (Object.keys(counts) as MediaKind[])
    .filter((k) => counts[k] > SLOT_CEILINGS[k])
    .map((k) => ({ kind: k, count: counts[k], max: SLOT_CEILINGS[k] }));
}
