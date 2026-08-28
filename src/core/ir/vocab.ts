/**
 * Closed vocabularies and exact strings from the MiniMax H3 official guides.
 *
 * Sources:
 *   - Video Prompt Writing Guide (T2VA / I2VA / FL2VA / L2VA)  -- the "base" contract
 *   - Full-Reference Mode Rewrite Output Format Guide          -- the "ref2va" contract
 *
 * Everything in this file is contract, not preference. If a value here is wrong
 * the model is being handed malformed conditioning, so each entry should be
 * traceable to a line in one of the two guides.
 */

// ---------------------------------------------------------------------------
// Modes and contracts
// ---------------------------------------------------------------------------

export const MODES = ['T2VA', 'I2VA', 'FL2VA', 'L2VA', 'Ref2VA'] as const;
export type H3Mode = (typeof MODES)[number];

/** Which output shape a mode serializes to. */
export type Contract = 'base' | 'ref2va';

export function contractFor(mode: H3Mode): Contract {
  return mode === 'Ref2VA' ? 'ref2va' : 'base';
}

/** Base contract: three fields, this order. Guide section 2.2. */
export const BASE_SECTIONS = [
  'integrated_multimodal_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const;

/** Full-reference contract: six sections, this order. Ref guide section 1. */
export const REF_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const;

// ---------------------------------------------------------------------------
// Alignment lines -- exact strings, two substitutions only
// ---------------------------------------------------------------------------

/**
 * T2VA has no alignment line and begins directly with the core fields.
 * The other three base modes each have one exact opening line, followed by a
 * single blank line before the fields. Guide section 2.1.
 *
 * `N`    -> index of the actual final shot
 * `S.SS` -> effective duration, exactly two decimal places
 */
export const ALIGNMENT_TEMPLATES = {
  T2VA: null,

  I2VA:
    'For the target video, at 0.00 seconds into the target video, ' +
    '<Picture 1> (from [Shot 1]) is fully referenced.',

  FL2VA:
    'How the reference pictures align with the target video — ' +
    'Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; ' +
    'Picture 2 (from Shot {N}) aligns with the {S.SS}-second mark of the target video.',

  L2VA:
    'How the reference pictures align with the target video — ' +
    '<Picture 1> (from [Shot {N}]) aligns with the {S.SS}-second mark of the target video.',

  Ref2VA: null,
} as const satisfies Record<H3Mode, string | null>;

// ---------------------------------------------------------------------------
// Camera -- motion type, amplitude, speed. Guide section 4.3.
// ---------------------------------------------------------------------------

export const CAMERA_TYPES = [
  'Zoom In',
  'Zoom Out',
  'Push In',
  'Pull Out',
  'Pan Left',
  'Pan Right',
  'Truck Left',
  'Truck Right',
  'Tilt Up',
  'Tilt Down',
  'Pedestal Up',
  'Pedestal Down',
  'Arc Shot',
  'Tracking Shot',
  'Static Shot',
  'Shake Slightly',
  'Shake Strongly',
  'POV',
  'Roll Clockwise',
  'Roll Counterclockwise',
] as const;
export type CameraType = (typeof CAMERA_TYPES)[number];

/** Medium amplitude and normal speed are implicit and are written as absent. */
export const AMPLITUDES = ['small', 'large'] as const;
export type Amplitude = (typeof AMPLITUDES)[number];

export const SPEEDS = ['slow', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];

export const AMPLITUDE_PHRASE: Record<Amplitude, string> = {
  small: 'with small amplitude',
  large: 'with large amplitude',
};

export const SPEED_PHRASE: Record<Speed, string> = {
  slow: 'at slow speed',
  fast: 'at fast speed',
};

/**
 * Verb forms the guide's own examples use when a camera motion is written as
 * natural prose inside a shot. Used by the validator to confirm a beat's prose
 * actually expresses the annotated motion rather than stacking it as a label.
 */
export const CAMERA_PROSE_HINTS: Record<CameraType, readonly string[]> = {
  'Zoom In': ['zooms in', 'zooming in'],
  'Zoom Out': ['zooms out', 'zooming out'],
  'Push In': ['pushes in', 'pushing in'],
  'Pull Out': ['pulls out', 'pulling out'],
  'Pan Left': ['pans left', 'panning left'],
  'Pan Right': ['pans right', 'panning right'],
  'Truck Left': ['trucks left', 'trucking left'],
  'Truck Right': ['trucks right', 'trucking right'],
  'Tilt Up': ['tilts up', 'tilting up'],
  'Tilt Down': ['tilts down', 'tilting down'],
  'Pedestal Up': ['pedestals up', 'rises', 'cranes up'],
  'Pedestal Down': ['pedestals down', 'lowers', 'cranes down'],
  'Arc Shot': ['arcs', 'arcing'],
  'Tracking Shot': ['tracks', 'tracking', 'follows'],
  'Static Shot': ['holds a static shot', 'remains static', 'stays still', 'holds still'],
  'Shake Slightly': ['shakes slightly'],
  'Shake Strongly': ['shakes strongly'],
  POV: ['point of view', 'POV'],
  'Roll Clockwise': ['rolls clockwise'],
  'Roll Counterclockwise': ['rolls counterclockwise'],
};

// ---------------------------------------------------------------------------
// Cuts. Guide section 4.2.
// ---------------------------------------------------------------------------

/** Ordinary cuts. Any of these five is legal for a plain cut. */
export const ORDINARY_CUTS = [
  'the camera cuts to',
  'the shot cuts to',
  'the shot transitions to',
  'the shot changes to',
  'the shot switches to',
] as const;

/** Only when the user explicitly asks for them. */
export const SPECIAL_CUTS = ['cross-dissolve', 'fade', 'wipe'] as const;

export type CutStyle = (typeof ORDINARY_CUTS)[number] | (typeof SPECIAL_CUTS)[number];

// ---------------------------------------------------------------------------
// Dialogue. Guide section 4.4.
// ---------------------------------------------------------------------------

/** Exact phrase required for voiceover. */
export const VOICEOVER_PHRASE = 'says in an off-screen voiceover';

// The lips-closed clause that base 4.4 requires after a voiceover <d> block has
// no constant here on purpose. The guide mandates the statement, not a wording
// ("state that the corresponding on-screen character's lips remain completely
// closed"), so an allowlist of four phrasings could only fire on legitimate
// prose that said the same thing differently. The planner and patch prompts
// carry the requirement instead. A list of variants lived here for a while with
// no caller, and the contract's description of VOICEOVER_PHRASE_MISSING claimed
// a check that was never written.

/** Continuity phrasing for dialogue that crosses a cut. Guide section 4.4. */
export const CONTINUITY_PHRASES = [
  'continues seamlessly across the cut',
  'continues uninterrupted into the next shot',
  'carries over from the previous shot',
  'remains audible across the transition',
] as const;

export const SCENETRANS_TAG = '<scenetrans>';
export const CUTOFF_TAG = '<cutoff>';

/**
 * Punctuation permitted inside <d>. Ref guide section 5.4: standardize to the
 * basic marks needed to express the sentence; strip tildes, emoji, bullets, and
 * decorative or repeated punctuation.
 */
export const DIALOGUE_ALLOWED_PUNCTUATION = [',', '.', '?', '!', "'", '-'] as const;
export const DIALOGUE_TERMINALS = ['.', '?', '!'] as const;

/** Marker for spans that could not be transcribed. Never guess or paraphrase. */
export const UNCLEAR_MARKER = '[unclear]';

// ---------------------------------------------------------------------------
// Reference labels. Ref guide section 2.
// ---------------------------------------------------------------------------

export const LABEL_KINDS = ['Subject', 'Picture', 'Video', 'Audio'] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * Per-kind Ref2VA slot ceilings.
 *
 * Not in either guide -- neither states a limit on reference assets at all.
 * A platform limit carried here without a guide citation; listed in the
 * contract's notInTheGuides so an audit can tell it from vocabulary.
 */
export const SLOT_CEILINGS: Record<MediaKind, number> = {
  image: 9,
  video: 3,
  audio: 3,
};

/**
 * What a reference asset contributes. The role decides which label kind the
 * slot carries and whether it earns a standalone definition line.
 *
 * Frame anchors get a standalone <Picture N> entry. Assets that only define a
 * character, scene, costume, or style are cited inside a <Subject N> instead --
 * ref guide section 2.2 is explicit that they must not get their own entry.
 */
export const SLOT_ROLES = [
  // -> standalone <Picture N>
  'first_frame',
  'last_frame',
  'keyframe',
  'storyboard',
  // -> cited inside a <Subject N>
  'identity',
  'wardrobe',
  'style',
  'scene',
  'prop',
  'motion',
  'camera',
  'performance',
  // -> <Video N>
  'edit_source',
  'continuation_source',
  'structure',
  // -> <Audio N>
  'voice',
  'music_style',
  'sfx',
  'soundtrack_copy',
] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/** Roles that make an image a concrete frame or planning anchor. */
export const FRAME_ANCHOR_ROLES: readonly SlotRole[] = [
  'first_frame',
  'last_frame',
  'keyframe',
  'storyboard',
];

/** Roles that describe reusable visible content, folded into a Subject. */
export const SUBJECT_CONTENT_ROLES: readonly SlotRole[] = [
  'identity',
  'wardrobe',
  'style',
  'scene',
  'prop',
  'motion',
  'camera',
  'performance',
];

/** Roles that describe a whole-video relationship. */
export const VIDEO_STRUCTURE_ROLES: readonly SlotRole[] = [
  'edit_source',
  'continuation_source',
  'structure',
];

/** Roles that describe an audio relationship. */
export const AUDIO_ROLES: readonly SlotRole[] = [
  'voice',
  'music_style',
  'sfx',
  'soundtrack_copy',
];

// ---------------------------------------------------------------------------
// Task types and retention markers. Ref guide sections 3 and 4.
// ---------------------------------------------------------------------------

export const TASK_TYPES = [
  'keyframe completion',
  'reference generation',
  'video editing',
  'video continuation',
  'audio reuse',
  'audio reference',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/** For <Subject N>, <Picture N>, <Video N>. Ref guide section 4.1. */
export const VISUAL_RETENTION = [
  'fully_preserved',
  'partially_preserved',
  'attribute_transfer',
  'weak_reference',
] as const;
export type VisualRetention = (typeof VISUAL_RETENTION)[number];

/** For <Audio N>. Ref guide section 4.2. */
export const AUDIO_RETENTION = [
  'fully_copy',
  'partially_copy',
  'reference',
  'weak_reference',
] as const;
export type AudioRetention = (typeof AUDIO_RETENTION)[number];

// ---------------------------------------------------------------------------
// Numeric constraints
// ---------------------------------------------------------------------------

/** ComfyUI's documented native output rate; used to convert frames to seconds. */
export const FPS = 24;

/** Frame grid: legal counts are 17k + 5. Workflow fact, kept configurable. */
export const FRAME_BLOCK = 17;
export const FRAME_OFFSET = 5;

/** overall_soundscape: 1-4 sentences. Guide section 4.6. */
export const SOUNDSCAPE_SENTENCE_RANGE = [1, 4] as const;

/** non_diegetic_music: 1-3 sentences. Guide section 4.7. */
export const MUSIC_SENTENCE_RANGE = [1, 3] as const;

/**
 * detailed_description word target. Ref guide section 5.2.
 *
 * Scoped by the guide, and the scope travels with the number: it is the range
 * for *generation* tasks. Video-editing descriptions scale with the complexity
 * of the source video and are exempt, and dialogue-dense content fits the
 * spoken timeline ahead of any count. A consumer that states the range without
 * both exemptions is quoting the guide wrongly.
 */
export const REF_DETAIL_WORD_RANGE = [350, 500] as const;

/** Value meaning "deliberately absent" in the two audio sections. */
export const NOT_APPLICABLE = 'N/A';
