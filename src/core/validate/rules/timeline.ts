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

/**
 * A beat's prose must not carry a shot header.
 *
 * Invariant 2 makes the structure the serializer's: it writes `[Shot N]` and
 * the cut time itself. So a beat carrying one renders the header twice, with
 * two timestamps that disagree -- `[Shot 2] At 00:05.000, [Shot 2] At
 * 00:04.000, ...`. That is provable from the document and its own derived
 * values, which is what separates it from a preference about wording. Before
 * this rule the whole thing validated at zero diagnostics.
 *
 * THE EXCLUSION IS LOAD-BEARING, NOT DEFENSIVE, and it is why the naive form of
 * this rule would have joined the seventeen removed for firing on legitimate
 * output. `visibleTextQuoted` in ./speech.ts REQUIRES every `visibleText` entry
 * to appear verbatim in English double quotes inside the prose, per base 4.5.
 * So a beat whose on-screen text is a clapperboard reading `[Shot 2]`
 * legitimately contains a shot header, validates clean, and is caught by the
 * unexcluded pattern. Measured against a fixture before the rule was written.
 *
 * That makes this rule COUPLED to `visibleTextQuoted`, invisibly from either
 * file: keying the exclusion on `"${entry}"` is only sound while that rule
 * guarantees the quoting. Relax it and this becomes a hole rather than a
 * failure, which is the direction that does not announce itself.
 */
export const shotHeaderInProse: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      const headers = [...beat.prose.matchAll(/\[Shot\s*\d+\]/g)];
      if (headers.length === 0) return;
      // POSITIONS, not strings, and the first version of this got it wrong in
      // both directions. Comparing the matched text against the declared
      // entries fails a slate reading `TAKE 3 [Shot 2]`, because the extracted
      // header is not the whole entry -- and worse, it let ONE quoted slate
      // excuse every identical bare header elsewhere in the same beat, since
      // two occurrences produce the same string. That second one is a bypass
      // rather than a miss: a beat that legitimately shows a header could then
      // carry unlimited bare ones for free.
      //
      // So a match is excluded only when it falls INSIDE the span of a quoted
      // `visibleText` occurrence. Declared AND quoted is the same pair
      // `visibleTextQuoted` checks; a header declared without quotes is still a
      // fault, and is already a VISIBLE_TEXT_NOT_QUOTED one.
      // `indexOf` on a literal, deliberately, and not a regex built from the
      // entry. `visibleText` is content the model writes, so compiling it into
      // a pattern would let `[Shot 2]` become a character class and match
      // something else entirely -- an injection through data this rule exists
      // to reason about. Left as a note because the next person to make this
      // loop faster will reach for a regex.
      const spans: [number, number][] = [];
      for (const entry of beat.visibleText ?? []) {
        const needle = `"${entry}"`;
        for (let at = beat.prose.indexOf(needle); at !== -1; at = beat.prose.indexOf(needle, at + 1)) {
          spans.push([at, at + needle.length]);
        }
      }
      const offending = headers
        .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index + m[0].length <= to))
        .map((m) => m[0]);
      if (offending.length === 0) return;
      out.push(
        error(
          'SHOT_HEADER_IN_PROSE',
          `shots[${i}].beats[${j}].prose`,
          `Beat prose writes ${offending[0]}. The serializer writes the shot header and its cut ` +
            'time, so this renders twice with two timestamps that disagree. Describe the action ' +
            'and let the structure be added around it.',
        ),
      );
    });
  });
  return out;
};

export const cutTimestampInProse: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      const matches = [...beat.prose.matchAll(/(?:\bAt\s+\d{2}:\d{2}\.\d{3}\b|\[\d{2}:\d{2}\.\d{3}\]|\b\d{2}:\d{2}\.\d{3}:)/g)];
      if (matches.length === 0) return;
      const spans: [number, number][] = [];
      for (const entry of beat.visibleText ?? []) {
        const needle = `"${entry}"`;
        for (let at = beat.prose.indexOf(needle); at !== -1; at = beat.prose.indexOf(needle, at + 1)) {
          spans.push([at, at + needle.length]);
        }
      }
      const offending = matches
        .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index + m[0].length <= to))
        .map((m) => m[0]);
      if (offending.length === 0) return;
      out.push(
        error(
          'CUT_TIMESTAMP_IN_PROSE',
          `shots[${i}].beats[${j}].prose`,
          `Beat prose writes cut timestamp "${offending[0]}". The serializer formats cut times deterministically; ` +
            'timestamps must not appear in beat prose.',
        ),
      );
    });
  });
  return out;
};

export const sectionHeaderInProse: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      const matches = [...beat.prose.matchAll(/\b(?:overall_soundscape|soundscape|camera_movement|camera_direction|action_description|beat_prose|dialogue_text):\s*/gi)];
      if (matches.length === 0) return;
      const spans: [number, number][] = [];
      for (const entry of beat.visibleText ?? []) {
        const needle = `"${entry}"`;
        for (let at = beat.prose.indexOf(needle); at !== -1; at = beat.prose.indexOf(needle, at + 1)) {
          spans.push([at, at + needle.length]);
        }
      }
      const offending = matches
        .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index + m[0].length <= to))
        .map((m) => m[0]);
      if (offending.length === 0) return;
      out.push(
        error(
          'SECTION_HEADER_IN_PROSE',
          `shots[${i}].beats[${j}].prose`,
          `Beat prose writes leaked section header "${offending[0]}". Section headers are structural and must not appear in beat prose.`,
        ),
      );
    });
  });
  return out;
};

export const alignmentLineInProse: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      const matches = [...beat.prose.matchAll(/\bHow the reference (?:pictures|images|videos|audio) align\b/gi)];
      if (matches.length === 0) return;
      const spans: [number, number][] = [];
      for (const entry of beat.visibleText ?? []) {
        const needle = `"${entry}"`;
        for (let at = beat.prose.indexOf(needle); at !== -1; at = beat.prose.indexOf(needle, at + 1)) {
          spans.push([at, at + needle.length]);
        }
      }
      const offending = matches
        .filter((m) => !spans.some(([from, to]) => m.index >= from && m.index + m[0].length <= to))
        .map((m) => m[0]);
      if (offending.length === 0) return;
      out.push(
        error(
          'ALIGNMENT_LINE_IN_PROSE',
          `shots[${i}].beats[${j}].prose`,
          `Beat prose writes reference alignment preamble "${offending[0]}". Alignment lines are synthesized by the serializer and must not appear in beat prose.`,
        ),
      );
    });
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
  frameRolesOnImages,
  shotHeaderInProse,
  cutTimestampInProse,
  sectionHeaderInProse,
  alignmentLineInProse,
];
