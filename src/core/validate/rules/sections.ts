/**
 * Audio sections, slot hygiene, and the full-reference contract.
 *
 * The Ref2VA rules are the bulk of this file because that contract carries four
 * things the base contract does not: a label registry, a task-type prefix, a
 * retention table with two different marker vocabularies, and a word target.
 */

import type { Diagnostic, Rule } from '../types';
import { error, warn } from '../types';
import {
  AUDIO_RETENTION,
  MUSIC_SENTENCE_RANGE,
  NOT_APPLICABLE,
  REF_DETAIL_WORD_RANGE,
  SOUNDSCAPE_SENTENCE_RANGE,
  VISUAL_RETENTION,
} from '../../ir/vocab';
import { countSentences, countWords } from '../../normalize/budgets';
import { ceilingViolations } from '../../normalize/labels';

// ---------------------------------------------------------------------------
// Audio sections
// ---------------------------------------------------------------------------

export const soundscapeLength: Rule = (doc) => {
  const text = doc.soundscape.trim();
  if (text === NOT_APPLICABLE) return [];
  const n = countSentences(text);
  const [min, max] = SOUNDSCAPE_SENTENCE_RANGE;
  if (n < min || n > max) {
    return [
      error(
        'SOUNDSCAPE_SENTENCE_COUNT',
        'soundscape',
        `overall_soundscape must be ${min}-${max} sentences; this has ${n}.`,
      ),
    ];
  }
  return [];
};

export const musicLength: Rule = (doc) => {
  const text = doc.music.trim();
  if (text === NOT_APPLICABLE) return [];
  const n = countSentences(text);
  const [min, max] = MUSIC_SENTENCE_RANGE;
  if (n < min || n > max) {
    return [
      error('MUSIC_SENTENCE_COUNT', 'music', `non_diegetic_music must be ${min}-${max} sentences; this has ${n}.`),
    ];
  }
  return [];
};

/**
 * Dialogue, singing and diegetic music belong in the description, not repeated
 * in the soundscape. Catches the common failure of restating a spoken line.
 */
export const soundscapeSeparation: Rule = (doc) => {
  const out: Diagnostic[] = [];
  const lines = doc.shots
    .flatMap((s) => s.beats)
    .map((b) => b.dialogue?.text.trim())
    .filter((t): t is string => !!t && t.length > 8);

  const soundscape = doc.soundscape.toLowerCase();
  lines.forEach((line) => {
    if (soundscape.includes(line.toLowerCase().replace(/[.?!]$/, ''))) {
      out.push(
        error(
          'SOUNDSCAPE_CONTAINS_DIALOGUE',
          'soundscape',
          'overall_soundscape repeats spoken dialogue. Dialogue belongs only in the description.',
        ),
      );
    }
  });
  return out;
};

/**
 * The guide asks for instrumentation, tempo, rhythm and dynamics, and warns off
 * abstract mood words. Advisory, since a phrase can be both.
 */
export const musicConcreteness: Rule = (doc) => {
  const text = doc.music.trim();
  if (text === NOT_APPLICABLE || text === '') return [];
  const abstract = /\b(emotional|moody|epic|dramatic|uplifting|sad|happy|tense|atmospheric)\b/i;
  if (abstract.test(text) && !/\b(piano|strings?|cello|guitar|synth|drum|bass|tempo|bpm|violin|horn|pad)\b/i.test(text)) {
    return [
      warn(
        'MUSIC_ABSTRACT',
        'music',
        'non_diegetic_music reads as mood rather than sound. Name instrumentation, tempo, and dynamics.',
      ),
    ];
  }
  return [];
};

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export const slotCeilings: Rule = (doc) => {
  return ceilingViolations(doc.slots).map((v) =>
    error('SLOT_CEILING_EXCEEDED', 'slots', `${v.count} ${v.kind} references attached; the documented maximum is ${v.max}.`),
  );
};

export const slotRoles: Rule = (doc) => {
  const out: Diagnostic[] = [];
  doc.slots.forEach((slot, i) => {
    if (slot.roles.length === 0) {
      out.push(
        error(
          'SLOT_NO_ROLES',
          `slots[${i}].roles`,
          `${slot.filename ?? slot.kind} has no role, so the prompt cannot say what job it does.`,
        ),
      );
    }
  });
  return out;
};

export const slotOrdering: Rule = (doc) => {
  const orders = doc.slots.map((s) => s.order).sort((a, b) => a - b);
  const out: Diagnostic[] = [];
  orders.forEach((o, i) => {
    if (o !== i) {
      out.push(
        error('SLOT_ORDER_NOT_CONTIGUOUS', 'slots', `Slot connection order must be 0..${orders.length - 1}; found ${orders.join(', ')}.`),
      );
    }
  });
  return out.slice(0, 1);
};

/** An attached asset nothing cites is conditioning the model on nothing. */
export const slotsUsed: Rule = (doc, ctx) => {
  if (doc.mode !== 'Ref2VA') return [];
  const out: Diagnostic[] = [];
  const citedInBeats = new Set(doc.shots.flatMap((s) => s.beats).flatMap((b) => b.citesSlots));
  const citedInSubjects = new Set(doc.subjects.flatMap((s) => s.sources.map((src) => src.slotId)));

  doc.slots.forEach((slot, i) => {
    if (citedInBeats.has(slot.id) || citedInSubjects.has(slot.id)) return;
    const label = ctx.labels.find((l) => l.slotId === slot.id);
    out.push(
      warn(
        'SLOT_UNUSED',
        `slots[${i}]`,
        `${label?.ref ?? slot.kind} is attached but never cited in a subject or a shot.`,
      ),
    );
  });
  return out;
};

// ---------------------------------------------------------------------------
// Ref2VA
// ---------------------------------------------------------------------------

export const refSummary: Rule = (doc) => {
  if (doc.mode !== 'Ref2VA') return [];
  const out: Diagnostic[] = [];
  if (!doc.summary || doc.summary.trim() === '') {
    out.push(error('REF_MISSING_SUMMARY', 'summary', 'Ref2VA requires a summary section.'));
  }
  if (!doc.taskTypes || doc.taskTypes.length === 0) {
    out.push(
      error('REF_MISSING_TASK_TYPES', 'taskTypes', 'Ref2VA requires at least one task type for the summary prefix.'),
    );
  } else {
    const seen = new Set<string>();
    doc.taskTypes.forEach((t) => {
      if (seen.has(t)) {
        out.push(error('REF_TASK_TYPE_DUPLICATE', 'taskTypes', `Task type "${t}" is listed more than once.`));
      }
      seen.add(t);
    });
  }
  return out;
};

/**
 * The summary uses labels already defined; it must not introduce new ones.
 */
export const refSummaryLabels: Rule = (doc, ctx) => {
  if (doc.mode !== 'Ref2VA' || !doc.summary) return [];
  const defined = new Set<string>([
    ...ctx.labels.map((l) => l.ref),
    ...doc.subjects.map((s) => `<Subject ${s.ordinal}>`),
  ]);
  const cited = doc.summary.match(/<(?:Subject|Picture|Video|Audio) \d+>/g) ?? [];
  const unknown = [...new Set(cited)].filter((c) => !defined.has(c));
  return unknown.map((c) =>
    error('REF_SUMMARY_NEW_LABEL', 'summary', `Summary cites ${c}, which is not defined in subject_definitions.`),
  );
};

/** Every label that exists needs a retention entry, and vice versa. */
export const refRetentionCoverage: Rule = (doc, ctx) => {
  if (doc.mode !== 'Ref2VA') return [];
  const out: Diagnostic[] = [];
  const entries = doc.retention ?? [];

  doc.subjects.forEach((subject, i) => {
    const has = entries.some((e) => e.target.type === 'subject' && e.target.subjectId === subject.id);
    if (!has) {
      out.push(
        error(
          'REF_RETENTION_MISSING',
          `subjects[${i}]`,
          `<Subject ${subject.ordinal}> has no retention_analysis entry.`,
        ),
      );
    }
  });

  ctx.labels
    .filter((l) => l.standalone)
    .forEach((label) => {
      const has = entries.some((e) => e.target.type === 'slot' && e.target.slotId === label.slotId);
      if (!has) {
        const i = doc.slots.findIndex((s) => s.id === label.slotId);
        out.push(error('REF_RETENTION_MISSING', `slots[${i}]`, `${label.ref} has no retention_analysis entry.`));
      }
    });

  return out;
};

/**
 * Audio labels take the audio marker vocabulary; Subject, Picture and Video take
 * the visual one. Mixing them produces a marker H3 has no meaning for.
 */
export const refRetentionMarkerClass: Rule = (doc, ctx) => {
  if (doc.mode !== 'Ref2VA') return [];
  const out: Diagnostic[] = [];
  const visual = new Set<string>(VISUAL_RETENTION);
  const audio = new Set<string>(AUDIO_RETENTION);

  (doc.retention ?? []).forEach((entry, i) => {
    const path = `retention[${i}].marker`;
    // Hoisted so the discriminant survives into the .some() closures.
    const target = entry.target;
    const isAudioTarget =
      target.type === 'slot' &&
      ctx.labels.some((l) => l.slotId === target.slotId && l.kind === 'Audio') &&
      !ctx.labels.some((l) => l.slotId === target.slotId && l.kind === 'Video');

    if (isAudioTarget && !audio.has(entry.marker)) {
      out.push(
        error(
          'REF_RETENTION_MARKER_WRONG_CLASS',
          path,
          `"${entry.marker}" is a visual marker on an audio label. Use one of: ${AUDIO_RETENTION.join(', ')}.`,
        ),
      );
    }
    if (!isAudioTarget && !visual.has(entry.marker)) {
      out.push(
        error(
          'REF_RETENTION_MARKER_WRONG_CLASS',
          path,
          `"${entry.marker}" is an audio marker on a visual label. Use one of: ${VISUAL_RETENTION.join(', ')}.`,
        ),
      );
    }
  });
  return out;
};

/** Speaker ids never appear in retention_analysis. Ref guide section 5.4. */
export const refNoSpeakerInRetention: Rule = (doc) => {
  if (doc.mode !== 'Ref2VA') return [];
  const out: Diagnostic[] = [];
  (doc.retention ?? []).forEach((entry, i) => {
    if (/\(S\d+(,S\d+)*\)/.test(entry.note) || /\(S\d+(,S\d+)*\)/.test(entry.context)) {
      out.push(
        error(
          'REF_SPEAKER_IN_RETENTION',
          `retention[${i}].note`,
          'Speaker ids must not appear in retention_analysis.',
        ),
      );
    }
  });
  return out;
};

/** A label cited in the body must have been defined. */
export const refLabelsDefined: Rule = (doc, ctx) => {
  if (doc.mode !== 'Ref2VA') return [];
  const defined = new Set<string>([
    ...ctx.labels.map((l) => l.ref),
    ...doc.subjects.map((s) => `<Subject ${s.ordinal}>`),
  ]);
  const out: Diagnostic[] = [];

  doc.shots.forEach((shot, i) => {
    shot.beats.forEach((beat, j) => {
      const cited = beat.prose.match(/<(?:Subject|Picture|Video|Audio) \d+>/g) ?? [];
      [...new Set(cited)].forEach((c) => {
        if (!defined.has(c)) {
          out.push(
            error(
              'REF_LABEL_UNDEFINED',
              `shots[${i}].beats[${j}].prose`,
              `${c} is cited but never defined in subject_definitions.`,
            ),
          );
        }
      });
    });
  });
  return out;
};

/** detailed_description has a soft word target for generation tasks. */
export const refDetailLength: Rule = (doc) => {
  if (doc.mode !== 'Ref2VA') return [];
  // Editing descriptions scale with the source video and are exempt.
  if (doc.taskTypes?.includes('video editing')) return [];

  // Dialogue-dense content is exempt too: the guide says such pieces prioritize
  // fitting the complete spoken timeline over mechanically reaching a word
  // count, and its own worked example sits under 350 words for exactly that
  // reason. A rule that flags the reference implementation is miscalibrated.
  const shotsWithDialogue = doc.shots.filter((s) => s.beats.some((b) => b.dialogue)).length;
  if (shotsWithDialogue >= 2) return [];

  const words = doc.shots
    .flatMap((s) => s.beats)
    .reduce((sum, b) => sum + countWords(b.prose), 0);
  const [min, max] = REF_DETAIL_WORD_RANGE;
  if (words < min) {
    return [
      warn('REF_DETAIL_WORD_COUNT', 'shots', `detailed_description is ${words} words; generation tasks target ${min}-${max}.`),
    ];
  }
  if (words > max * 1.3) {
    return [
      warn('REF_DETAIL_WORD_COUNT', 'shots', `detailed_description is ${words} words, well past the ${min}-${max} target.`),
    ];
  }
  return [];
};

export const sectionRules: Rule[] = [
  soundscapeLength,
  musicLength,
  soundscapeSeparation,
  musicConcreteness,
  slotCeilings,
  slotRoles,
  slotOrdering,
  slotsUsed,
  refSummary,
  refSummaryLabels,
  refRetentionCoverage,
  refRetentionMarkerClass,
  refNoSpeakerInRetention,
  refLabelsDefined,
  refDetailLength,
];
