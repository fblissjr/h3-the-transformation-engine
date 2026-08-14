/**
 * Structure, duration, shots and camera.
 *
 * These are the rules that keep the derived scaffolding honest: shot numbering,
 * cut times, and the agreement between a camera annotation and the prose that
 * is supposed to express it.
 */

import type { Diagnostic, Rule } from '../types';
import { error, warn } from '../types';
import { CAMERA_PROSE_HINTS, CAMERA_TYPES, FRAME_ANCHOR_ROLES } from '../../ir/vocab';
import { comfortableLatestCutMs } from '../../normalize/budgets';
import { isOnFrameGrid, nearestGridFrames } from '../../normalize/duration';

/** The document must have something to render. */
export const shotsPresent: Rule = (doc) => {
  if (doc.shots.length === 0) {
    return [error('NO_SHOTS', 'shots', 'The document has no shots; there is nothing to render.')];
  }
  return [];
};

export const stylePresent: Rule = (doc) => {
  if (doc.style.trim() === '') {
    return [
      warn(
        'EMPTY_STYLE',
        'style',
        'No style stated. Shot 1 should open with the medium and look, e.g. "Live-action, cinematic".',
      ),
    ];
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

/**
 * The 17k+5 frame grid is a workflow fact, so missing it is advisory. The prompt
 * stays valid; it just describes a duration the workflow will not render.
 */
export const frameGrid: Rule = (doc) => {
  if (doc.durationFrames == null) return [];
  if (isOnFrameGrid(doc.durationFrames)) return [];
  return [
    warn(
      'FRAME_GRID_OFF',
      'durationFrames',
      `${doc.durationFrames} frames is not on the 17k+5 grid; the workflow will snap to ${nearestGridFrames(
        doc.durationFrames,
      )}.`,
    ),
  ];
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
  const comfortable = comfortableLatestCutMs(ctx.durationSeconds);
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
    } else if (shot.cutAtMs > comfortable) {
      out.push(
        warn(
          'CUT_TOO_LATE',
          path,
          `Cut at ${shot.cutAtMs}ms leaves under 1.5s of video after it.`,
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

/**
 * FL2VA interpolates between two boundary frames and the guide asks for a single
 * shot unless multiple were explicitly requested. Advisory, since "explicitly
 * requested" is a user intent the document cannot record.
 */
export const fl2vaSingleShot: Rule = (doc) => {
  if (doc.mode !== 'FL2VA' || doc.shots.length <= 1) return [];
  return [
    warn(
      'FL2VA_MULTISHOT',
      'shots',
      `FL2VA usually favours a single shot so the model can interpolate continuously; this has ${doc.shots.length}.`,
    ),
  ];
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

/**
 * A camera annotation must be visible in the prose.
 *
 * This is the rule that enforces the project's central design decision: prose is
 * authoritative and enums annotate it. If the annotation says "Push In" and no
 * beat in the shot says the camera pushes in, one of the two is a lie, and the
 * model only ever sees the prose.
 */
export const cameraProseAgreement: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    if (!shot.camera) return;
    const path = `shots[${i}].camera.type`;

    if (!(CAMERA_TYPES as readonly string[]).includes(shot.camera.type)) {
      out.push(error('CAMERA_TYPE_INVALID', path, `"${shot.camera.type}" is not a documented camera motion.`));
      return;
    }

    const prose = shot.beats.map((b) => b.prose).join(' ').toLowerCase();
    const hints = CAMERA_PROSE_HINTS[shot.camera.type];
    if (!hints.some((h) => prose.includes(h.toLowerCase()))) {
      out.push(
        error(
          'CAMERA_PROSE_MISSING',
          path,
          `Shot ${i + 1} is annotated "${shot.camera.type}" but no beat expresses it. Expected wording like "${hints[0]}".`,
        ),
      );
    }
  });
  return out;
};

/**
 * Camera direction must read as prose, not as a trailing label stack. The guide
 * calls this out explicitly and gives "Camera: push in, slow, small amplitude."
 * as the thing to avoid.
 */
export const noCameraLabelStack: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      if (/\b(camera|shot)\s*:/i.test(beat.prose)) {
        out.push(
          error(
            'CAMERA_LABEL_STACK',
            `shots[${i}].beats[${j}].prose`,
            'Camera direction is written as a detached label. Express it as natural action inside the sentence.',
          ),
        );
      }
    });
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
  stylePresent,
  durationPositive,
  frameGrid,
  shotIndices,
  shotTimestamps,
  cutTimes,
  shotsHaveBeats,
  fl2vaSingleShot,
  modeMatchesSlots,
  cameraProseAgreement,
  noCameraLabelStack,
  frameRolesOnImages,
];
