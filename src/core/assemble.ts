/**
 * Planner output -> document.
 *
 * The planner returns creative content addressed by ordinal: "the speaker who
 * is (S1)", "the asset at slot order 3". This turns those ordinals into the
 * stable ids the document uses, and fills in every derived field the planner was
 * never asked for -- shot indices, subject ordinals, retention entries for
 * subjects.
 *
 * Ids are positional and deterministic rather than random, so the same plan
 * assembles to the same document every time and fixtures stay diffable.
 */

import type {
  CompileInput,
  H3Document,
  NormalizedContext,
  RetentionEntry,
  Shot,
  Speaker,
  Subject,
} from './ir/types';
import type { PlannerOutput } from './ir/schema';
import type { LabelKind } from './ir/vocab';

export class AssembleError extends Error {}

export interface AssembleOptions {
  /** Document id. Supplied so the caller controls identity across regenerations. */
  id: string;
  modeLocked?: boolean;
}

export function assemble(
  plan: PlannerOutput,
  input: CompileInput,
  ctx: NormalizedContext,
  options: AssembleOptions,
): H3Document {
  const slotsByOrder = new Map(input.slots.map((s) => [s.order, s]));

  // --- speakers ----------------------------------------------------------
  const speakers: Speaker[] = plan.speakers.map((s, i) => ({
    id: `sp-${i + 1}`,
    ordinal: i + 1,
    descriptor: s.descriptor,
    ...(s.subject != null ? { subjectId: `subj-${s.subject}` } : {}),
    ...(s.compoundOf && s.compoundOf.length > 0
      ? { compoundOf: s.compoundOf.map((o) => `sp-${o}`) }
      : {}),
  }));

  const speakerByOrdinal = new Map(speakers.map((s) => [s.ordinal, s]));

  // --- subjects ----------------------------------------------------------
  const subjects: Subject[] = plan.subjects.map((s, i) => ({
    id: `subj-${i + 1}`,
    ordinal: i + 1,
    sources: s.sources.map((src) => {
      const slot = slotsByOrder.get(src.slotOrder);
      if (!slot) {
        throw new AssembleError(
          `Subject ${i + 1} cites slot order ${src.slotOrder}, which was never attached.`,
        );
      }
      return { slotId: slot.id, provides: src.provides };
    }),
    traits: s.traits,
    // Shot ids are positional, so a 1-based shot number maps straight across.
    appearsInShots: s.appearsInShots.map((n) => `shot-${n}`),
    retention: s.retention,
    retentionNote: s.retentionNote,
  }));

  // --- shots and beats ---------------------------------------------------
  const shots: Shot[] = plan.shots.map((shot, i) => ({
    id: `shot-${i + 1}`,
    index: i + 1,
    // The first shot never carries a timestamp, whatever the planner returned.
    cutAtMs: i === 0 ? null : shot.cutAtMs,
    ...(shot.cutStyle ? { cutStyle: shot.cutStyle } : {}),
    camera: shot.camera,
    beats: shot.beats.map((beat, j) => {
      const speaker = beat.speaker != null ? speakerByOrdinal.get(beat.speaker) : undefined;
      if (beat.speaker != null && !speaker) {
        throw new AssembleError(
          `Shot ${i + 1} beat ${j + 1} is attributed to (S${beat.speaker}), which was never declared.`,
        );
      }
      return {
        id: `beat-${i + 1}-${j + 1}`,
        prose: beat.prose,
        ...(speaker ? { speakerId: speaker.id } : {}),
        ...(beat.dialogue
          ? {
              dialogue: {
                language: beat.dialogue.language,
                text: beat.dialogue.text,
                voiceover: beat.dialogue.voiceover,
                ...(beat.dialogue.crossesCut ? { crossesCut: beat.dialogue.crossesCut } : {}),
                ...(beat.dialogue.cutoff ? { cutoff: true } : {}),
                ...(beat.dialogue.fragment ? { fragment: true } : {}),
                userSupplied: (input.suppliedDialogue ?? []).some(
                  (line) => line.trim() === beat.dialogue!.text.trim(),
                ),
              },
            }
          : {}),
        visibleText: beat.visibleText,
        citesSlots: beat.citesSlots
          .map((order) => slotsByOrder.get(order)?.id)
          .filter((id): id is string => id != null),
        citesSubjects: beat.citesSubjects.map((o) => `subj-${o}`),
      };
    }),
  }));

  // --- retention ---------------------------------------------------------
  // Subject entries are derived from the subjects themselves; only the slot
  // entries come from the planner, because only those need a judgment call the
  // subject list does not already record.
  const retention: RetentionEntry[] = [
    ...subjects.map((s) => ({
      target: { type: 'subject' as const, subjectId: s.id },
      context: '',
      marker: s.retention,
      note: s.retentionNote,
    })),
    ...(plan.pictureRetention ?? []).flatMap((r) => {
      const slot = slotsByOrder.get(r.slotOrder);
      if (!slot) return [];
      return [
        {
          // The planner returns the two kinds in separate fields, so which
          // label this line is about is known here and never guessed later.
          target: {
            type: 'slot' as const,
            slotId: slot.id,
            labelKind: (slot.kind === 'video' ? 'Video' : 'Picture') as LabelKind,
          },
          context: r.context,
          marker: r.marker,
          note: r.note,
        },
      ];
    }),
    ...(plan.audioRetention ?? []).flatMap((r) => {
      const slot = slotsByOrder.get(r.slotOrder);
      if (!slot) return [];
      return [
        {
          target: { type: 'slot' as const, slotId: slot.id, labelKind: 'Audio' as LabelKind },
          context: '',
          marker: r.marker,
          note: r.note,
        },
      ];
    }),
  ];

  const isRef = ctx.contract === 'ref2va';

  return {
    schemaVersion: '1.0.0',
    id: options.id,
    mode: ctx.mode,
    modeLocked: options.modeLocked ?? false,
    durationFrames: ctx.durationFrames,
    durationSeconds: ctx.durationSeconds,
    style: plan.style,
    slots: input.slots,
    subjects: isRef ? subjects : [],
    speakers,
    shots,
    soundscape: plan.soundscape,
    music: plan.music,
    ...(isRef
      ? {
          summary: plan.summary ?? '',
          taskTypes: plan.taskTypes ?? [],
          retention,
        }
      : {}),
    // Input metadata that belongs to the document rather than to the plan: what
    // the prose was written under, and which roll produced the idea. Stamped
    // here rather than by the caller, because a caller that forgets is a
    // document that silently loses the record -- and the callers are the two
    // that had already forgotten something once.
    ...(input.creativeMode ? { creativeMode: input.creativeMode } : {}),
    ...(input.roll ? { roll: input.roll } : {}),
  };
}
