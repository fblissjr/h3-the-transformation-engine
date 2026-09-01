/**
 * Zod schemas for the document and for the planner's output.
 *
 * Two schemas, deliberately different shapes:
 *
 *  - `H3DocumentSchema` validates a stored document. It includes derived fields
 *    (shot indices, subject ordinals) because a stored document must be
 *    internally consistent.
 *
 *  - `PlannerOutputSchema` is what the model is allowed to return. It omits
 *    every derived field. The planner makes creative decisions; it does not get
 *    to assign a shot number or a label ordinal, because those follow from
 *    position and connection order and a model that guesses them will
 *    eventually guess wrong.
 *
 * The planner schema is also the source of the JSON Schema sent as
 * `response_format`, so the two can never drift apart.
 */

import { z } from 'zod';
import {
  AMPLITUDES,
  AUDIO_RETENTION,
  CAMERA_TYPES,
  LABEL_KINDS,
  MEDIA_KINDS,
  MODES,
  ORDINARY_CUTS,
  SLOT_ROLES,
  SPECIAL_CUTS,
  SPEEDS,
  TASK_TYPES,
  VISUAL_RETENTION,
} from './vocab';

// ---------------------------------------------------------------------------
// Shared leaves
// ---------------------------------------------------------------------------

const cameraSchema = z.object({
  type: z.enum(CAMERA_TYPES),
  amplitude: z.enum(AMPLITUDES).optional(),
  speed: z.enum(SPEEDS).optional(),
});

const dialogueSchema = z.object({
  language: z.string().min(1),
  text: z.string().min(1),
  voiceover: z.boolean(),
  crossesCut: z.enum(['starts', 'continues']).optional(),
  cutoff: z.boolean().optional(),
  fragment: z.boolean().optional(),
  userSupplied: z.boolean(),
});

const cutStyleSchema = z.enum([...ORDINARY_CUTS, ...SPECIAL_CUTS]);

// ---------------------------------------------------------------------------
// Stored document
// ---------------------------------------------------------------------------

export const ReferenceSlotSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  kind: z.enum(MEDIA_KINDS),
  roles: z.array(z.enum(SLOT_ROLES)).min(1),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  dataUrl: z.string().optional(),
  description: z.string(),
  audioDescription: z.string().optional(),
});

export const SubjectSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().min(1),
  sources: z.array(
    z.object({
      slotId: z.string().min(1),
      provides: z.string(),
    }),
  ),
  traits: z.string(),
  appearsInShots: z.array(z.string()),
  retention: z.enum(VISUAL_RETENTION),
  retentionNote: z.string(),
});

export const SpeakerSchema = z.object({
  id: z.string().min(1),
  ordinal: z.number().int().min(1),
  descriptor: z.string(),
  subjectId: z.string().optional(),
  compoundOf: z.array(z.string()).optional(),
});

export const BeatSchema = z.object({
  id: z.string().min(1),
  prose: z.string(),
  speakerId: z.string().optional(),
  dialogue: dialogueSchema.optional(),
  visibleText: z.array(z.string()),
  citesSlots: z.array(z.string()),
  citesSubjects: z.array(z.string()),
});

export const ShotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(1),
  cutAtMs: z.number().int().min(0).nullable(),
  cutStyle: cutStyleSchema.optional(),
  camera: cameraSchema.nullable(),
  beats: z.array(BeatSchema),
});

export const RetentionEntrySchema = z.object({
  target: z.union([
    z.object({ type: z.literal('subject'), subjectId: z.string().min(1) }),
    z.object({
      type: z.literal('slot'),
      slotId: z.string().min(1),
      // Optional: documents written before a slot could carry two labels have
      // no kind, and mean the primary one.
      labelKind: z.enum(LABEL_KINDS).optional(),
    }),
  ]),
  context: z.string(),
  marker: z.union([z.enum(VISUAL_RETENTION), z.enum(AUDIO_RETENTION)]),
  note: z.string(),
});

/**
 * Pack ids are left as bare strings rather than enums built from the tables.
 *
 * A stored document can name a pack that a later build renamed or dropped, and
 * the right response to that is the style quietly resolving to nothing -- which
 * `styleDirective` already does -- not the whole document failing to parse and
 * the user losing their work.
 *
 * `visual` also accepts a number, which is what reference anchors were before
 * they moved into the packs' id space. Narrowing this to a string is what the
 * rule above exists to prevent: it made every document written with an anchor
 * selected fail to parse and lose its style. `getVisual` understands both.
 */
const CreativeModeSchema = z.object({
  mode: z.enum(['directed', 'exploratory', 'wild']),
  selection: z.object({
    visual: z.union([z.string(), z.number()]).optional(),
    motion: z.string().optional(),
    finish: z.string().optional(),
    audio: z.string().optional(),
    strength: z.enum(['subtle', 'full', 'stress-test']),
  }),
  /**
   * Declared, and not only for validation: an object schema drops keys it does
   * not describe, so an undeclared `glitch` would vanish from anything read
   * through this schema without an issue being raised anywhere.
   *
   * Ids stay bare strings for the reason every other id here does -- a build
   * that drops a token must not make the documents written before it
   * unopenable. `register` is gated like `strength`, being a closed control
   * vocabulary rather than a name for a piece of content.
   */
  glitch: z
    .object({
      tokens: z.array(z.string()),
      surfaces: z.array(z.string()).optional(),
      register: z.enum(['motif', 'ood']),
    })
    .optional(),
});

export const H3DocumentSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  id: z.string().min(1),
  mode: z.enum(MODES),
  modeLocked: z.boolean(),
  durationFrames: z.number().int().positive().nullable(),
  durationSeconds: z.number().positive(),
  style: z.string(),
  slots: z.array(ReferenceSlotSchema),
  subjects: z.array(SubjectSchema),
  speakers: z.array(SpeakerSchema),
  shots: z.array(ShotSchema).min(1),
  soundscape: z.string(),
  music: z.string(),
  summary: z.string().optional(),
  taskTypes: z.array(z.enum(TASK_TYPES)).optional(),
  retention: z.array(RetentionEntrySchema).optional(),
  creativeMode: CreativeModeSchema.optional(),
  /** Declared for the same reason the glitch record is: an undeclared key is dropped. */
  roll: z.object({ template: z.string(), seed: z.number() }).optional(),
});

// ---------------------------------------------------------------------------
// Planner output
// ---------------------------------------------------------------------------

/**
 * Beats as the planner returns them: prose plus the annotations needed to
 * validate it. No ids -- those are assigned on assembly.
 *
 * `speaker` is a 1-based ordinal, matching the (Sx) the planner is told to use.
 * It is resolved to a real speaker id during assembly, which is also where an
 * ordinal referring to a speaker that was never declared becomes an error
 * rather than a dangling reference.
 */
const PlannedBeatSchema = z.object({
  prose: z.string().min(1).describe('The actual sentences for this beat. This is what conditions the model.'),
  speaker: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe('1-based speaker ordinal for a vocal event in this beat, or null.'),
  dialogue: z
    .object({
      language: z.string().min(1).describe('Language tag written inside <d>, e.g. "English".'),
      text: z.string().min(1).describe('Exact spoken words. Never translated or paraphrased.'),
      voiceover: z.boolean(),
      crossesCut: z.enum(['starts', 'continues']).nullable(),
      cutoff: z.boolean(),
      // Optional, unlike its neighbours, and the asymmetry is deliberate.
      // Schema enforcement is off by default, so a newly required field is a
      // new way for an entire plan to fail safeParse when a model simply omits
      // it. Absent means "complete", which is the behaviour that already
      // shipped.
      fragment: z
        .boolean()
        .optional()
        .describe('True when the words are a fragment rather than a complete statement.'),
    })
    .nullable(),
  visibleText: z.array(z.string()).describe('Text visible on screen, verbatim, without quote marks.'),
  citesSlots: z.array(z.number().int().min(0)).describe('0-based slot orders cited in this beat.'),
  citesSubjects: z.array(z.number().int().min(1)).describe('1-based subject ordinals cited in this beat.'),
});

const PlannedShotSchema = z.object({
  cutAtMs: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe('Cut time in milliseconds. Must be null for the first shot.'),
  cutStyle: cutStyleSchema.nullable(),
  camera: cameraSchema.nullable().describe('Annotation describing the camera work the prose expresses.'),
  beats: z.array(PlannedBeatSchema).min(1),
});

const PlannedSubjectSchema = z.object({
  sources: z
    .array(
      z.object({
        slotOrder: z.number().int().min(0).describe('0-based slot order this subject draws from.'),
        provides: z.string().describe('What this asset contributes, e.g. "appearance", "walking motion".'),
      }),
    )
    .min(1),
  traits: z
    .string()
    .min(1)
    .describe('Only traits visible in the supplied asset or stated in its description. Never inferred.'),
  appearsInShots: z.array(z.number().int().min(1)).describe('1-based shot numbers this subject appears in.'),
  retention: z.enum(VISUAL_RETENTION),
  retentionNote: z.string(),
});

const PlannedSpeakerSchema = z.object({
  descriptor: z
    .string()
    .min(1)
    .describe('Identifying phrase used on first appearance: type, age, gender, pitch, timbre, delivery.'),
  subject: z
    .number()
    .int()
    .min(1)
    .nullable()
    .describe('1-based subject ordinal when this speaker is a defined subject, else null.'),
  compoundOf: z
    .array(z.number().int().min(1))
    .nullable()
    .describe('For chorus speech only: the 1-based ordinals speaking together.'),
});

export const PlannerOutputSchema = z.object({
  style: z.string().min(1).describe('Medium and finish, written as an opening clause. e.g. "Stop-motion felt puppetry, shallow depth of field".'),
  shots: z.array(PlannedShotSchema).min(1),
  speakers: z.array(PlannedSpeakerSchema),
  subjects: z.array(PlannedSubjectSchema).describe('Ref2VA only. Empty array for the base contract.'),
  soundscape: z.string().min(1).describe('overall_soundscape: 1-4 sentences, or "N/A" for requested silence.'),
  music: z.string().min(1).describe('non_diegetic_music: 1-3 sentences, or "N/A" when absent.'),
  summary: z
    .string()
    .nullable()
    .describe(
      'Ref2VA only. One or two sentences, physical verbs only, no speech acts. The task-type prefix is added for you.',
    ),
  taskTypes: z.array(z.enum(TASK_TYPES)).nullable().describe('Ref2VA only.'),
  audioRetention: z
    .array(
      z.object({
        slotOrder: z.number().int().min(0),
        marker: z.enum(AUDIO_RETENTION),
        note: z.string(),
      }),
    )
    .nullable()
    .describe('Ref2VA only. One entry per audio slot.'),
  pictureRetention: z
    .array(
      z.object({
        slotOrder: z.number().int().min(0),
        context: z.string().describe('e.g. "[Shot 1] first frame", "cut and pacing structure".'),
        marker: z.enum(VISUAL_RETENTION),
        note: z.string(),
      }),
    )
    .nullable()
    .describe('Ref2VA only. One entry per standalone Picture or Video slot.'),
});

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

// ---------------------------------------------------------------------------
// Patch output
// ---------------------------------------------------------------------------

/**
 * What a surgical or wide edit returns.
 *
 * Operations name a path and a replacement value. The model never returns a
 * rewritten document -- that would lose the surgical property and let unrelated
 * fields drift on every edit. Paths are checked against the allowlist in
 * paths.ts before anything is applied.
 */
export const PatchOutputSchema = z.object({
  operations: z
    .array(
      z.object({
        path: z.string().min(1).describe('Document path, e.g. "shots[0].beats[1].prose".'),
        value: z.string().describe('Replacement value. Strings only; structural edits are not patches.'),
        rationale: z.string().describe('One sentence on why this change satisfies the instruction.'),
      }),
    )
    .min(1),
  /** Anything the model refused to do, and why. Surfaced to the user, not silently dropped. */
  declined: z
    .array(
      z.object({
        what: z.string(),
        why: z.string(),
      }),
    )
    .nullable(),
});

export type PatchOutput = z.infer<typeof PatchOutputSchema>;

// ---------------------------------------------------------------------------
// JSON Schema for response_format
// ---------------------------------------------------------------------------

/**
 * The Interactions API takes a JSON Schema, so these are generated from the zod
 * schemas above rather than hand-written. Hand-written duplicates drift; the
 * failure mode is a model that returns a shape the parser rejects, which reads
 * as a model problem and is not one.
 */
export function plannerJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PlannerOutputSchema, { io: 'output' }) as Record<string, unknown>;
}

export function patchJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PatchOutputSchema, { io: 'output' }) as Record<string, unknown>;
}
