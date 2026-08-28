/**
 * The full-reference contract: Ref2VA.
 *
 * Six sections in fixed order (ref guide section 1). Unlike the base contract,
 * each section name sits on its own line, and shots in `detailed_description`
 * are line-separated with the style stated as its own sentence before [Shot 1].
 *
 * Almost everything structural here is derived rather than written: label
 * ordinals, the task-type prefix, the `(appears in [Shot 1], [Shot 3])`
 * parentheticals, and the retention marker column. The model supplies the prose
 * in each entry and nothing else.
 */

import type { H3Document, NormalizedContext, SlotLabel } from '../ir/types';
import type { LabelKind } from '../ir/vocab';
import { Emitter } from './emitter';
import type { SourceSpan } from './emitter';
import { renderBeats, renderShotHeader } from './shared';

/**
 * The label a retention line is about.
 *
 * `kind` comes from the entry, because the marker cannot supply it:
 * `weak_reference` belongs to both marker vocabularies, so a `<Video N>`
 * structural line -- the ref guide's own 4.1 example -- was rendering under
 * `<Audio N>` whenever the slot carried both labels. With no kind stored, the
 * primary label is meant, which is what every document written before the field
 * existed intends.
 */
function labelRef(labels: SlotLabel[], slotId: string, kind?: LabelKind): string {
  const own = labels.filter((l) => l.slotId === slotId);
  const picked = kind ? own.find((l) => l.kind === kind) ?? own[0] : own.find((l) => l.kind !== 'Audio') ?? own[0];
  return picked?.ref ?? `<missing slot ${slotId}>`;
}

/** `[Shot 1], [Shot 3]` from shot ids, in document order. */
function shotList(doc: H3Document, shotIds: string[]): string {
  return doc.shots
    .filter((s) => shotIds.includes(s.id))
    .map((s) => `[Shot ${s.index}]`)
    .join(', ');
}

export function serializeRef2va(
  doc: H3Document,
  ctx: NormalizedContext,
): { text: string; map: SourceSpan[] } {
  const e = new Emitter();
  const labels = ctx.labels;

  // --- subject_definitions -----------------------------------------------
  e.write('subject_definitions:');
  e.newline();
  e.block('subjects', () => {
    doc.subjects.forEach((subject, i) => {
      e.writeAt(`subjects[${i}].traits`, `<Subject ${subject.ordinal}> ${subject.traits.trim()}`);
      e.newline();
    });
  });
  // Standalone Picture / Video / Audio entries. A slot whose roles only define a
  // character, scene, costume or style earns no line here -- it is cited inside
  // whichever Subject uses it.
  e.block('slots', () => {
    labels
      .filter((l) => l.standalone)
      .forEach((label) => {
        const slotIndex = doc.slots.findIndex((s) => s.id === label.slotId);
        if (slotIndex < 0) return;
        const slot = doc.slots[slotIndex];
        // A video whose soundtrack is used has two labels and needs two
        // sentences; with one field the same one rendered twice, once
        // describing a video under an Audio label.
        const audio = label.kind === 'Audio' && slot.audioDescription?.trim();
        const field = audio ? 'audioDescription' : 'description';
        const text = audio ? slot.audioDescription!.trim() : slot.description.trim();
        e.writeAt(`slots[${slotIndex}].${field}`, `${label.ref} ${text}`);
        e.newline();
      });
  });
  e.newline();

  // --- summary ------------------------------------------------------------
  e.write('summary:');
  e.newline();
  const prefix = doc.taskTypes && doc.taskTypes.length > 0 ? `[${doc.taskTypes.join(' + ')}] ` : '';
  e.write(prefix);
  e.writeAt('summary', (doc.summary ?? '').trim());
  e.newline(2);

  // --- retention_analysis -------------------------------------------------
  e.write('retention_analysis:');
  e.newline();
  e.block('retention', () => {
    (doc.retention ?? []).forEach((entry, i) => {
      const path = `retention[${i}]`;
      // Hoisted so the discriminant survives into the closures below.
      const target = entry.target;
      let ref: string;
      let context: string;

      if (target.type === 'subject') {
        const subject = doc.subjects.find((s) => s.id === target.subjectId);
        ref = subject ? `<Subject ${subject.ordinal}>` : `<missing subject>`;
        context = entry.context.trim() || (subject ? `appears in ${shotList(doc, subject.appearsInShots)}` : '');
      } else {
        ref = labelRef(labels, target.slotId, target.labelKind);
        context = entry.context.trim();
      }

      e.block(path, () => {
        e.write(ref);
        // Audio entries carry no parenthetical in the guide's example.
        if (context !== '') e.write(` (${context})`);
        e.write(': ');
        e.writeAt(`${path}.marker`, entry.marker);
        e.write(' - ');
        e.writeAt(`${path}.note`, entry.note.trim());
      });
      e.newline();
    });
  });
  e.newline();

  // --- detailed_description -----------------------------------------------
  e.write('detailed_description:');
  e.newline();
  // Style is its own sentence here, ahead of [Shot 1].
  if (doc.style.trim() !== '') {
    const style = doc.style.trim();
    e.writeAt('style', /[.!?]$/.test(style) ? style : `${style}.`);
    e.newline();
  }
  e.block('shots', () => {
    doc.shots.forEach((shot, shotIndex) => {
      const shotPath = `shots[${shotIndex}]`;
      e.block(shotPath, () => {
        e.write(renderShotHeader(shot));
        e.write(' ');
        renderBeats(shot).forEach((prose, beatIndex) => {
          if (beatIndex > 0) e.write(' ');
          e.writeAt(`${shotPath}.beats[${beatIndex}].prose`, prose);
        });
      });
      e.newline();
    });
  });
  e.newline();

  // --- overall_soundscape -------------------------------------------------
  e.write('overall_soundscape:');
  e.newline();
  e.writeAt('soundscape', doc.soundscape.trim());
  e.newline(2);

  // --- non_diegetic_music -------------------------------------------------
  e.write('non_diegetic_music:');
  e.newline();
  e.writeAt('music', doc.music.trim());

  return e.build();
}
