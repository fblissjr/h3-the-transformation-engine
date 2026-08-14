/**
 * Mode inference from the attached slots.
 *
 * The result is an OFFER, never a decision. Both the official guide and the
 * community kit make the same point: an image alone does not establish its role.
 * The same JPEG is a first frame, a last frame, or a style reference depending
 * entirely on what the user meant, and only the user knows. So inference reads
 * the roles the user assigned, and the UI still lets them override the answer.
 */

import type { ReferenceSlot } from '../ir/types';
import type { H3Mode } from '../ir/vocab';
import { AUDIO_ROLES, VIDEO_STRUCTURE_ROLES } from '../ir/vocab';

export interface ModeInference {
  mode: H3Mode;
  /** Why this mode was chosen, shown next to the picker. */
  reason: string;
  /**
   * False when the slots do not clearly determine a mode -- typically an image
   * with no role assigned yet. The UI should ask rather than proceed.
   */
  confident: boolean;
}

function rolesOf(slots: ReferenceSlot[]): Set<string> {
  return new Set(slots.flatMap((s) => s.roles));
}

export function inferMode(slots: ReferenceSlot[]): ModeInference {
  if (slots.length === 0) {
    return { mode: 'T2VA', reason: 'No reference media attached.', confident: true };
  }

  const images = slots.filter((s) => s.kind === 'image');
  const videos = slots.filter((s) => s.kind === 'video');
  const audios = slots.filter((s) => s.kind === 'audio');
  const roles = rolesOf(slots);

  // Any video or audio at all puts this in full-reference territory: the base
  // contract has no way to talk about a <Video N> or an <Audio N>.
  if (videos.length > 0 || audios.length > 0) {
    const why: string[] = [];
    if (videos.length > 0) why.push(`${videos.length} video reference${videos.length > 1 ? 's' : ''}`);
    if (audios.length > 0) why.push(`${audios.length} audio reference${audios.length > 1 ? 's' : ''}`);
    return {
      mode: 'Ref2VA',
      reason: `${why.join(' and ')} attached; only the full-reference contract can address them.`,
      confident: true,
    };
  }

  // Images only from here down.
  const hasFirst = roles.has('first_frame');
  const hasLast = roles.has('last_frame');
  const anyRole = images.some((s) => s.roles.length > 0);

  if (!anyRole) {
    return {
      mode: 'I2VA',
      reason: 'An image is attached but no role is assigned yet -- pick one to settle the mode.',
      confident: false,
    };
  }

  if (images.length === 1 && hasFirst && !hasLast) {
    return { mode: 'I2VA', reason: 'One image, used as the first frame.', confident: true };
  }

  if (images.length === 2 && hasFirst && hasLast) {
    return { mode: 'FL2VA', reason: 'Two images, used as the first and last frames.', confident: true };
  }

  if (images.length === 1 && hasLast && !hasFirst) {
    return { mode: 'L2VA', reason: 'One image, used as the last frame.', confident: true };
  }

  // More than two images, or images carrying identity/style/scene roles, is
  // exactly what full-reference mode exists for.
  const contentRoles = [...roles].filter(
    (r) => !VIDEO_STRUCTURE_ROLES.includes(r as never) && !AUDIO_ROLES.includes(r as never),
  );
  return {
    mode: 'Ref2VA',
    reason:
      images.length > 2
        ? `${images.length} images attached; more than a first/last pair needs the full-reference contract.`
        : `Image roles (${contentRoles.join(', ')}) describe reusable content rather than boundary frames.`,
    confident: true,
  };
}

/** Which slot ordering a mode requires, for the UI to surface before generating. */
export function modeRequirements(mode: H3Mode): string[] {
  switch (mode) {
    case 'T2VA':
      return ['No reference media.'];
    case 'I2VA':
      return ['Exactly one image, role "first_frame". It becomes <Picture 1> at 0.00s.'];
    case 'FL2VA':
      return [
        'Two images: the first connected is the opening frame, the second the ending frame.',
        'Prefers a single shot so the model can interpolate continuously.',
      ];
    case 'L2VA':
      return ['Exactly one image, role "last_frame". The video converges on it at the end.'];
    case 'Ref2VA':
      return [
        'Up to 9 images, 3 videos, 3 audio clips.',
        'Every asset needs at least one role, so the prompt can state what job it does.',
      ];
  }
}
