/**
 * Slot hygiene and the full-reference contract.
 *
 * The Ref2VA rules are the bulk of this file because that contract carries
 * three things the base contract does not: a label registry, a task-type
 * prefix, and a retention table with two different marker vocabularies. All
 * three are decidable from structure.
 */

import type { Diagnostic, Rule } from '../types';
import { error } from '../types';
import { AUDIO_RETENTION, VISUAL_RETENTION } from '../../ir/vocab';
import { ceilingViolations } from '../../normalize/labels';

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

export const sectionRules: Rule[] = [
  slotCeilings,
  slotRoles,
  slotOrdering,
  refSummary,
  refSummaryLabels,
  refRetentionCoverage,
  refRetentionMarkerClass,
  refNoSpeakerInRetention,
  refLabelsDefined,
];
