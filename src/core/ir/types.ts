/**
 * The H3 document model.
 *
 * This is the saved artifact. The H3 prompt text is a pure function of it --
 * see src/core/serialize. Nothing else in the app may hand-edit prompt text,
 * because derived values (alignment lines, shot numbers, cut times, label
 * ordinals) would immediately fall out of sync.
 *
 * Design rule that governs the whole model: BEATS CARRY PROSE. The planner
 * writes the actual sentences; the serializer only assembles structure around
 * them -- labels, timestamps, tags, section headers, ordering. Enums such as
 * `camera` are validated ANNOTATIONS on that prose, never a source the
 * serializer expands into sentences. H3 conditions on descriptive quality, and
 * a canned clause bolted onto a sentence is exactly the "detached command
 * stack" the official guide tells you to avoid.
 */

import type {
  Amplitude,
  AudioRetention,
  CameraType,
  CutStyle,
  H3Mode,
  MediaKind,
  SlotRole,
  Speed,
  TaskType,
  VisualRetention,
} from './vocab';
import type { CreativeModeRecord, StyleInjection } from '../creative/types';

// ---------------------------------------------------------------------------
// Reference slots
// ---------------------------------------------------------------------------

/**
 * One attached asset, in connection order.
 *
 * `order` drives label ordinals and is the only thing that does -- labels are
 * always derived, never stored. Picture, Video and Audio are numbered
 * independently within their own category, so the same source video can
 * legitimately be <Video 1> and <Audio 2>.
 */
export interface ReferenceSlot {
  id: string;
  /** 0-based position in connection order. Contiguous across all slots. */
  order: number;
  kind: MediaKind;
  /** At least one. Decides label kind and whether a standalone entry is earned. */
  roles: SlotRole[];
  filename?: string;
  mimeType?: string;
  /**
   * Base64 data URL. Images only in v1 -- video and audio reach the API as a
   * Files-API uri, which is deliberately out of scope for now, so those slots
   * carry a written `description` instead.
   */
  dataUrl?: string;
  /** User-written, or derived from vision analysis for image slots. */
  description: string;
}

/** A derived label. Never stored on the slot; recomputed from order + roles. */
export interface SlotLabel {
  slotId: string;
  kind: 'Picture' | 'Video' | 'Audio';
  /** 1-based, independent per kind. */
  ordinal: number;
  /** Rendered form, e.g. "<Picture 2>". */
  ref: string;
  /**
   * True when the slot is a concrete frame or planning anchor and so earns its
   * own line in subject_definitions. False when it only defines a character,
   * scene, costume, or style -- those are cited inside a <Subject N> instead.
   */
  standalone: boolean;
}

// ---------------------------------------------------------------------------
// Subjects -- the Ref2VA content registry
// ---------------------------------------------------------------------------

/**
 * Reusable visible content abstracted from one or more assets.
 *
 * Subjects and slots are many-to-many on purpose: the ref guide states that one
 * subject may be defined by multiple assets and one asset may provide multiple
 * subjects. Collapsing them into one table loses both directions.
 */
export interface Subject {
  id: string;
  /** 1-based, drives <Subject N>. */
  ordinal: number;
  /** Which assets contribute, and what each one provides. */
  sources: SubjectSource[];
  /** Prose description of the referenced characteristics. */
  traits: string;
  /** Shot ids the subject appears in; renders as "(appears in [Shot 1], [Shot 3])". */
  appearsInShots: string[];
  retention: VisualRetention;
  retentionNote: string;
}

export interface SubjectSource {
  slotId: string;
  /** e.g. "appearance", "walking motion". Empty when the whole asset applies. */
  provides: string;
}

// ---------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------

/**
 * A vocal source. IDs are assigned by order of actual vocal events in the
 * target video and stay stable across shots. Characters who never vocalize get
 * no speaker at all.
 */
export interface Speaker {
  id: string;
  /** 1-based, drives (S1), (S2). */
  ordinal: number;
  /**
   * Identifying phrase used on first appearance -- character type, age, gender,
   * on/off-screen, pitch, timbre, rate, accent. Written outside <d>.
   */
  descriptor: string;
  /** Ref2VA: when the speaker is a defined subject, renders as <Subject N> (Sx). */
  subjectId?: string;
  /**
   * Compound speech. When two already-numbered speakers vocalize together the
   * rendered id is a compound such as (S1,S2); this lists the members.
   */
  compoundOf?: string[];
}

// ---------------------------------------------------------------------------
// Shots and beats
// ---------------------------------------------------------------------------

export interface CameraAnnotation {
  type: CameraType;
  /** Medium is implicit -- leave undefined rather than encoding it. */
  amplitude?: Amplitude;
  /** Normal is implicit -- leave undefined rather than encoding it. */
  speed?: Speed;
}

export interface Shot {
  id: string;
  /** 1-based, drives [Shot N]. Recomputed on reorder, never stored stale. */
  index: number;
  /**
   * Cut time in milliseconds. Null for Shot 1, which carries no timestamp.
   * Later shots must be strictly increasing and inside the video duration.
   */
  cutAtMs: number | null;
  /** Which cut phrasing to use. Ignored for Shot 1. */
  cutStyle?: CutStyle;
  /** Annotation on the shot's camera work, validated against the beat prose. */
  camera: CameraAnnotation | null;
  beats: Beat[];
}

export interface Dialogue {
  /** Language tag written inside <d>, e.g. "English". */
  language: string;
  /** Verbatim spoken content. Never translated or rewritten. */
  text: string;
  voiceover: boolean;
  /**
   * Set when this line crosses a cut. 'starts' marks the part before the cut,
   * 'continues' the part after; both sides carry <scenetrans>.
   */
  crossesCut?: 'starts' | 'continues';
  /** True when speech is truncated by the end of the video -- renders <cutoff>. */
  cutoff?: boolean;
  /**
   * True when the words came from the user. The validator refuses to let a
   * patch alter them, which is the whole point of tracking this.
   */
  userSupplied: boolean;
}

/**
 * One beat of the timeline.
 *
 * `prose` is authoritative and is what actually conditions the model. Every
 * other field on a beat is either structure the serializer needs or an
 * annotation the validator checks the prose against.
 */
export interface Beat {
  id: string;
  prose: string;
  /** Speaker id, when this beat contains a vocal event. */
  speakerId?: string;
  dialogue?: Dialogue;
  /** Text visible on screen. Rendered in English double quotes, verbatim. */
  visibleText: string[];
  /** Slot ids cited here. Ref2VA renders these as <Picture N> / <Video N> / <Audio N>. */
  citesSlots: string[];
  /** Subject ids cited here. Ref2VA renders these as <Subject N>. */
  citesSubjects: string[];
}

// ---------------------------------------------------------------------------
// Ref2VA retention
// ---------------------------------------------------------------------------

export type RetentionTarget =
  | { type: 'subject'; subjectId: string }
  | { type: 'slot'; slotId: string };

export interface RetentionEntry {
  target: RetentionTarget;
  /**
   * Parenthetical context, e.g. "appears in [Shot 1], [Shot 3]",
   * "[Shot 1] first frame", "cut and pacing structure".
   */
  context: string;
  /** Visual markers for Subject/Picture/Video; audio markers for Audio. */
  marker: VisualRetention | AudioRetention;
  note: string;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface H3Document {
  schemaVersion: '1.0.0';
  id: string;
  mode: H3Mode;
  /**
   * True when the user picked the mode explicitly. Mode is otherwise inferred
   * from the slots -- an image alone does not establish its own role, so the
   * inference is an offer, not a decision.
   */
  modeLocked: boolean;

  /** Authoritative when known; seconds are derived from it. */
  durationFrames: number | null;
  /** Effective duration in seconds. Rendered to exactly two decimals. */
  durationSeconds: number;

  /**
   * Visual style clause. Placement differs by contract: the base contract opens
   * [Shot 1] with it, while Ref2VA states it in its own sentence before [Shot 1].
   */
  style: string;

  slots: ReferenceSlot[];
  subjects: Subject[];
  speakers: Speaker[];
  shots: Shot[];

  /** overall_soundscape. 1-4 sentences, or "N/A" for requested total silence. */
  soundscape: string;
  /** non_diegetic_music. 1-3 sentences, or "N/A" when absent. */
  music: string;

  // --- Ref2VA only ---
  /** One short paragraph, prefixed with the bracketed task types. */
  summary?: string;
  /** Joined with " + " in the summary prefix; no repeats. */
  taskTypes?: TaskType[];
  /** One entry per reference label. */
  retention?: RetentionEntry[];

  /** Which creative mode produced this document, if any. Metadata only -- the serializer ignores it. */
  creativeMode?: CreativeModeRecord;
}

// ---------------------------------------------------------------------------
// Compiler inputs and outputs
// ---------------------------------------------------------------------------

/** What the user supplies before anything has been planned. */
export interface CompileInput {
  idea: string;
  mode?: H3Mode;
  durationFrames?: number;
  durationSeconds?: number;
  slots: ReferenceSlot[];
  /** Dialogue the user wants preserved word for word. */
  suppliedDialogue?: string[];
  /** Creative mode style injection. Affects the planner prompt, not the serialized output. */
  style?: StyleInjection;
}

/** Everything the normalizer can work out without asking a model. */
export interface NormalizedContext {
  mode: H3Mode;
  contract: 'base' | 'ref2va';
  durationFrames: number | null;
  durationSeconds: number;
  /** Duration rendered to exactly two decimals, for the alignment line. */
  durationText: string;
  /** Whether durationFrames landed on the 17k+5 grid. Advisory only. */
  onFrameGrid: boolean;
  /** Latest legal cut time in ms; a cut at or past this leaves no shot behind it. */
  latestCutMs: number;
  /** Suggested shot count from duration. Advisory -- the planner may differ. */
  recommendedShots: number;
  /** Conservative spoken-word budget across the whole clip. */
  spokenWordBudget: number;
  /** Derived labels, one per slot. */
  labels: SlotLabel[];
}
