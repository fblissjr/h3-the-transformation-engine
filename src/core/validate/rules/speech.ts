/**
 * Speakers, dialogue, and visible text.
 *
 * The densest cluster of exact-string requirements in the format, and the one
 * where a near-miss is most expensive: a voiceover missing its lips-closed
 * clause produces a character whose mouth moves under narration, and altered
 * dialogue produces a video saying something the user did not write.
 */

import type { Diagnostic, Rule } from '../types';
import { error, warn } from '../types';
import {
  CONTINUITY_PHRASES,
  LIPS_CLOSED_PHRASES,
  SCENETRANS_TAG,
  CUTOFF_TAG,
  VOICEOVER_PHRASE,
} from '../../ir/vocab';
import { countWords } from '../../normalize/budgets';
import { DIALOGUE_PLACEHOLDER } from '../../serialize/shared';

/** Every beat in document order, with its path. */
function beatsOf(doc: Parameters<Rule>[0]) {
  return doc.shots.flatMap((shot, i) =>
    shot.beats.map((beat, j) => ({ beat, shot, path: `shots[${i}].beats[${j}]`, shotIndex: i, beatIndex: j })),
  );
}

export const speakerOrdinals: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.speakers.forEach((s, i) => {
    if (s.ordinal !== i + 1) {
      out.push(
        error(
          'SPEAKER_ORDINALS_NOT_SEQUENTIAL',
          `speakers[${i}].ordinal`,
          `Speaker at position ${i + 1} has ordinal ${s.ordinal}. Ordinals must run 1..${doc.speakers.length}.`,
        ),
      );
    }
  });
  return out;
};

/**
 * IDs are assigned in the order vocal events actually occur. A speaker that
 * first talks in Shot 3 cannot be (S1) if someone else spoke in Shot 1.
 */
export const speakerAssignmentOrder: Rule = (doc) => {
  const out: Diagnostic[] = [];
  const firstUse = new Map<string, number>();
  beatsOf(doc).forEach(({ beat }, order) => {
    if (beat.speakerId && !firstUse.has(beat.speakerId)) firstUse.set(beat.speakerId, order);
  });

  const used = [...firstUse.entries()]
    .map(([id, order]) => ({ speaker: doc.speakers.find((s) => s.id === id), order }))
    .filter((x): x is { speaker: NonNullable<typeof x.speaker>; order: number } => x.speaker != null)
    // Compound speakers are a rendering of existing ordinals, not a new source.
    .filter((x) => !x.speaker.compoundOf || x.speaker.compoundOf.length === 0)
    .sort((a, b) => a.order - b.order);

  used.forEach((x, i) => {
    if (x.speaker.ordinal !== i + 1) {
      out.push(
        error(
          'SPEAKER_ORDER_WRONG',
          `speakers[${doc.speakers.indexOf(x.speaker)}].ordinal`,
          `(S${x.speaker.ordinal}) first speaks ${i === 0 ? 'first' : `${i + 1}th`}; ids follow the order of vocal events, so it should be (S${i + 1}).`,
        ),
      );
    }
  });
  return out;
};

export const speakerReferences: Rule = (doc) => {
  const out: Diagnostic[] = [];
  beatsOf(doc).forEach(({ beat, path }) => {
    if (!beat.speakerId) return;
    const speaker = doc.speakers.find((s) => s.id === beat.speakerId);
    if (!speaker) {
      out.push(
        error('SPEAKER_UNDECLARED', `${path}.speakerId`, `Beat references speaker "${beat.speakerId}", which is not declared.`),
      );
      return;
    }
    const expected = speaker.compoundOf?.length
      ? `(S${speaker.compoundOf
          .map((id) => doc.speakers.find((s) => s.id === id)?.ordinal)
          .filter(Boolean)
          .sort()
          .join(',S')})`
      : `(S${speaker.ordinal})`;
    if (!beat.prose.includes(expected)) {
      out.push(
        error(
          'SPEAKER_REF_MISSING_IN_PROSE',
          `${path}.prose`,
          `Beat is attributed to ${expected} but the prose never writes that id.`,
        ),
      );
    }
  });
  return out;
};

/** A speaker's first appearance has to establish who is talking and how they sound. */
export const speakerIntroduced: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.speakers.forEach((s, i) => {
    if (s.compoundOf && s.compoundOf.length > 0) return;
    if (s.descriptor.trim() === '') {
      out.push(
        error(
          'SPEAKER_NOT_INTRODUCED',
          `speakers[${i}].descriptor`,
          `(S${s.ordinal}) has no identifying description. First appearance needs type, age, gender, pitch, timbre or delivery.`,
        ),
      );
    }
  });
  return out;
};

export const compoundSpeakers: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.speakers.forEach((s, i) => {
    if (!s.compoundOf || s.compoundOf.length === 0) return;
    if (s.compoundOf.length < 2) {
      out.push(
        error('COMPOUND_SPEAKER_INVALID', `speakers[${i}].compoundOf`, 'A compound speaker needs at least two members.'),
      );
    }
    s.compoundOf.forEach((id) => {
      if (id === s.id) {
        out.push(error('COMPOUND_SPEAKER_INVALID', `speakers[${i}].compoundOf`, 'A compound speaker cannot contain itself.'));
      } else if (!doc.speakers.some((o) => o.id === id)) {
        out.push(
          error('COMPOUND_SPEAKER_INVALID', `speakers[${i}].compoundOf`, `Member "${id}" is not a declared speaker.`),
        );
      }
    });
  });
  return out;
};

/**
 * Dialogue and its insertion point have to agree.
 *
 * The serializer splices the <d> block at the placeholder, so a beat carrying
 * dialogue with no placeholder would silently drop the line, and a placeholder
 * with no dialogue would leave the literal token in the prompt.
 */
export const dialoguePlacement: Rule = (doc) => {
  const out: Diagnostic[] = [];
  beatsOf(doc).forEach(({ beat, path }) => {
    const hasPlaceholder = beat.prose.includes(DIALOGUE_PLACEHOLDER);
    if (beat.dialogue && !hasPlaceholder) {
      out.push(
        error(
          'DIALOGUE_PLACEHOLDER_MISSING',
          `${path}.prose`,
          `Beat has dialogue but the prose has no ${DIALOGUE_PLACEHOLDER} marking where it goes.`,
        ),
      );
    }
    if (!beat.dialogue && hasPlaceholder) {
      out.push(
        error(
          'DIALOGUE_PLACEHOLDER_ORPHAN',
          `${path}.prose`,
          `Prose contains ${DIALOGUE_PLACEHOLDER} but the beat has no dialogue to splice in.`,
        ),
      );
    }
  });
  return out;
};

export const dialoguePunctuation: Rule = (doc) => {
  const out: Diagnostic[] = [];
  beatsOf(doc).forEach(({ beat, path }) => {
    const d = beat.dialogue;
    if (!d) return;
    const text = d.text.trim();

    if (text !== '' && !/[.?!]$/.test(text)) {
      out.push(
        error(
          'DIALOGUE_BAD_TERMINAL',
          `${path}.dialogue.text`,
          'Dialogue must end with ".", "?" or "!".',
        ),
      );
    }
    // Tildes, emoji, bullets, and repeated or decorative punctuation are stripped
    // by the format; leaving them in changes what gets spoken.
    if (/[~•·]|\.{2,}|!{2,}|\?{2,}|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) {
      out.push(
        error(
          'DIALOGUE_DECORATIVE_PUNCT',
          `${path}.dialogue.text`,
          'Dialogue contains decorative or repeated punctuation. Standardize to , . ? and !.',
        ),
      );
    }
  });
  return out;
};

export const voiceover: Rule = (doc) => {
  const out: Diagnostic[] = [];
  beatsOf(doc).forEach(({ beat, path }) => {
    if (!beat.dialogue?.voiceover) return;
    const prose = beat.prose.toLowerCase();

    if (!prose.includes(VOICEOVER_PHRASE)) {
      out.push(
        error(
          'VOICEOVER_PHRASE_MISSING',
          `${path}.prose`,
          `Voiceover requires the exact phrase "${VOICEOVER_PHRASE}".`,
        ),
      );
    }
    if (!LIPS_CLOSED_PHRASES.some((p) => prose.includes(p))) {
      out.push(
        error(
          'VOICEOVER_LIPS_MISSING',
          `${path}.prose`,
          'Every voiceover must be followed by a statement that the on-screen character\'s lips remain completely closed.',
        ),
      );
    }
  });
  return out;
};

/**
 * A line crossing a cut needs <scenetrans> on both sides plus an explicit
 * statement that the audio continues. One side alone leaves the model no signal
 * that the two fragments are one utterance.
 */
export const crossCutDialogue: Rule = (doc) => {
  const out: Diagnostic[] = [];
  const starts = beatsOf(doc).filter((b) => b.beat.dialogue?.crossesCut === 'starts');
  const continues = beatsOf(doc).filter((b) => b.beat.dialogue?.crossesCut === 'continues');

  if (starts.length !== continues.length) {
    out.push(
      error(
        'SCENETRANS_UNPAIRED',
        starts[0]?.path ?? continues[0]?.path ?? 'shots',
        `${starts.length} dialogue line(s) marked as starting across a cut but ${continues.length} marked as continuing.`,
      ),
    );
  }

  [...starts, ...continues].forEach(({ beat, path }) => {
    if (!beat.prose.includes(SCENETRANS_TAG)) {
      out.push(
        error('SCENETRANS_UNPAIRED', `${path}.prose`, `Dialogue crosses a cut but the prose has no ${SCENETRANS_TAG}.`),
      );
    }
    const prose = beat.prose.toLowerCase();
    if (!CONTINUITY_PHRASES.some((p) => prose.includes(p))) {
      out.push(
        warn(
          'CONTINUITY_PHRASE_MISSING',
          `${path}.prose`,
          `State the continuity explicitly, e.g. "${CONTINUITY_PHRASES[0]}".`,
        ),
      );
    }
  });

  return out;
};

/** <cutoff> means truncated by the end of the video, so it can only be last. */
export const cutoffPlacement: Rule = (doc) => {
  const out: Diagnostic[] = [];
  const all = beatsOf(doc);
  all.forEach(({ beat, path }, i) => {
    const marked = beat.dialogue?.cutoff || beat.prose.includes(CUTOFF_TAG);
    if (marked && i !== all.length - 1) {
      out.push(
        error(
          'CUTOFF_NOT_AT_END',
          `${path}.prose`,
          `${CUTOFF_TAG} marks speech truncated by the end of the video, so it can only appear in the final beat.`,
        ),
      );
    }
  });
  return out;
};

export const dialogueBudget: Rule = (doc, ctx) => {
  const total = doc.shots
    .flatMap((s) => s.beats)
    .reduce((sum, b) => sum + (b.dialogue ? countWords(b.dialogue.text) : 0), 0);
  if (total <= ctx.spokenWordBudget) return [];
  return [
    warn(
      'DIALOGUE_OVER_BUDGET',
      'shots',
      `${total} spoken words across ${ctx.durationText}s; roughly ${ctx.spokenWordBudget} fits comfortably.`,
    ),
  ];
};

/** Text visible on screen must actually appear, in double quotes, in the prose. */
export const visibleTextQuoted: Rule = (doc) => {
  const out: Diagnostic[] = [];
  beatsOf(doc).forEach(({ beat, path }) => {
    beat.visibleText.forEach((text) => {
      if (!beat.prose.includes(`"${text}"`)) {
        out.push(
          error(
            'VISIBLE_TEXT_NOT_QUOTED',
            `${path}.prose`,
            `On-screen text ${JSON.stringify(text)} must appear verbatim in English double quotes in the prose.`,
          ),
        );
      }
    });
  });
  return out;
};

export const speechRules: Rule[] = [
  speakerOrdinals,
  speakerAssignmentOrder,
  speakerReferences,
  speakerIntroduced,
  compoundSpeakers,
  dialoguePlacement,
  dialoguePunctuation,
  voiceover,
  crossCutDialogue,
  cutoffPlacement,
  dialogueBudget,
  visibleTextQuoted,
];
