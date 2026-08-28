/**
 * Structure, duration, shots and camera.
 *
 * These are the rules that keep the derived scaffolding honest: shot numbering,
 * cut times, and the agreement between a camera annotation and the prose that
 * is supposed to express it.
 */

import type { Diagnostic, Rule } from '../types';
import { error } from '../types';
import { CAMERA_TYPES, FRAME_ANCHOR_ROLES } from '../../ir/vocab';

/** The document must have something to render. */
export const shotsPresent: Rule = (doc) => {
  if (doc.shots.length === 0) {
    return [error('NO_SHOTS', 'shots', 'The document has no shots; there is nothing to render.')];
  }
  return [];
};

export const durationPositive: Rule = (doc) => {
  if (!(doc.durationSeconds > 0)) {
    return [
      error('DURATION_NOT_POSITIVE', 'durationSeconds', `Duration must be positive, got ${doc.durationSeconds}.`),
    ];
  }
  return [];
};

/** Shot indices must be 1..n in order, because [Shot N] and the alignment line depend on it. */
export const shotIndices: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    if (shot.index !== i + 1) {
      out.push(
        error(
          'SHOT_INDEX_NOT_SEQUENTIAL',
          `shots[${i}].index`,
          `Shot at position ${i + 1} is numbered ${shot.index}. Indices must run 1..${doc.shots.length}.`,
        ),
      );
    }
  });
  return out;
};

/** Shot 1 carries no timestamp; every later shot must carry one. */
export const shotTimestamps: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    if (i === 0 && shot.cutAtMs != null) {
      out.push(error('SHOT_1_HAS_TIMESTAMP', `shots[0].cutAtMs`, 'Shot 1 must not carry a cut time.'));
    }
    if (i > 0 && shot.cutAtMs == null) {
      out.push(
        error('SHOT_MISSING_TIMESTAMP', `shots[${i}].cutAtMs`, `Shot ${i + 1} needs a cut time.`),
      );
    }
  });
  return out;
};

/** Cut times strictly increase and stay inside the video. */
export const cutTimes: Rule = (doc, ctx) => {
  const out: Diagnostic[] = [];
  let previous = -1;

  doc.shots.forEach((shot, i) => {
    if (shot.cutAtMs == null) return;
    const path = `shots[${i}].cutAtMs`;

    if (shot.cutAtMs <= previous) {
      out.push(
        error(
          'CUT_NOT_INCREASING',
          path,
          `Cut at ${shot.cutAtMs}ms does not come after the previous cut at ${previous}ms.`,
        ),
      );
    }
    if (shot.cutAtMs > ctx.latestCutMs) {
      out.push(
        error(
          'CUT_OUTSIDE_DURATION',
          path,
          `Cut at ${shot.cutAtMs}ms falls at or past the ${ctx.durationText}s end of the video.`,
        ),
      );
    }
    previous = shot.cutAtMs;
  });

  return out;
};

export const shotsHaveBeats: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    if (shot.beats.length === 0) {
      out.push(error('SHOT_NO_BEATS', `shots[${i}].beats`, `Shot ${i + 1} has no beats.`));
    }
  });
  return out;
};

/** The mode and the attached slots have to describe the same job. */
export const modeMatchesSlots: Rule = (doc) => {
  const out: Diagnostic[] = [];
  const images = doc.slots.filter((s) => s.kind === 'image');
  const nonImages = doc.slots.filter((s) => s.kind !== 'image');
  const roles = new Set(doc.slots.flatMap((s) => s.roles));

  const expect = (ok: boolean, message: string) => {
    if (!ok) out.push(error('MODE_SLOT_MISMATCH', 'mode', message));
  };

  switch (doc.mode) {
    case 'T2VA':
      expect(doc.slots.length === 0, `T2VA takes no reference media, but ${doc.slots.length} are attached.`);
      break;
    case 'I2VA':
      expect(
        images.length === 1 && nonImages.length === 0 && roles.has('first_frame'),
        'I2VA needs exactly one image with the first_frame role and no other media.',
      );
      break;
    case 'FL2VA':
      expect(
        images.length === 2 && nonImages.length === 0 && roles.has('first_frame') && roles.has('last_frame'),
        'FL2VA needs exactly two images, one first_frame and one last_frame.',
      );
      break;
    case 'L2VA':
      expect(
        images.length === 1 && nonImages.length === 0 && roles.has('last_frame'),
        'L2VA needs exactly one image with the last_frame role and no other media.',
      );
      break;
    case 'Ref2VA':
      expect(doc.slots.length > 0, 'Ref2VA needs at least one reference asset.');
      break;
  }
  return out;
};

/** A camera annotation must name a documented motion. */
export const cameraTypeValid: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    if (!shot.camera) return;
    if (!(CAMERA_TYPES as readonly string[]).includes(shot.camera.type)) {
      out.push(
        error(
          'CAMERA_TYPE_INVALID',
          `shots[${i}].camera.type`,
          `"${shot.camera.type}" is not a documented camera motion.`,
        ),
      );
    }
  });
  return out;
};

/**
 * A shot's cut phrasing must be the phrasing its prose actually uses.
 *
 * The five ordinary cuts are exact strings from guide section 4.2, and the
 * planner is told to open a later shot's first beat with one of them. The
 * document records which, and the editor offers it as a dropdown -- so without
 * this the dropdown changes an annotation that reaches no output and disagrees
 * with the prose from then on. That is the same silent disagreement the camera
 * annotation would have, except a cut phrase is a fixed string rather than free
 * prose, so it can be checked exactly.
 */
export const cutStylePhrasing: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    // Shot 1 has no cut to phrase.
    if (i === 0 || !shot.cutStyle) return;
    const first = shot.beats[0];
    if (!first) return;
    if (!first.prose.includes(shot.cutStyle)) {
      out.push(
        error(
          'CUT_STYLE_NOT_IN_PROSE',
          `shots[${i}].beats[0].prose`,
          `Shot ${i + 1} is annotated "${shot.cutStyle}" but its first beat never writes that phrase.`,
        ),
      );
    }
  });
  return out;
};

/** Frame-anchor roles only make sense on images. */
export const frameRolesOnImages: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.slots.forEach((slot, i) => {
    if (slot.kind === 'image') return;
    const bad = slot.roles.filter((r) => FRAME_ANCHOR_ROLES.includes(r));
    if (bad.length > 0) {
      out.push(
        error(
          'FRAME_ROLE_ON_NON_IMAGE',
          `slots[${i}].roles`,
          `Frame-anchor role${bad.length > 1 ? 's' : ''} ${bad.join(', ')} on a ${slot.kind} slot. Only images can be frame anchors.`,
        ),
      );
    }
  });
  return out;
};

export const timelineRules: Rule[] = [
  shotsPresent,
  durationPositive,
  shotIndices,
  shotTimestamps,
  cutTimes,
  shotsHaveBeats,
  modeMatchesSlots,
  cameraTypeValid,
  cutStylePhrasing,
  frameRolesOnImages,
];
