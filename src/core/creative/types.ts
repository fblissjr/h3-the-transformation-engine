/**
 * Shared types for the creative mode system.
 *
 * Creative modes inject structured style directives into the planner's system
 * prompt. They affect what the LLM is asked to write, not how the serializer
 * formats it. The deterministic pipeline stays untouched.
 */

// ---------------------------------------------------------------------------
// Pack identifiers
// ---------------------------------------------------------------------------

/** Visual-medium packs V01-V24. */
export type VisualPackId =
  | 'V01' | 'V02' | 'V03' | 'V04' | 'V05' | 'V06' | 'V07' | 'V08'
  | 'V09' | 'V10' | 'V11' | 'V12' | 'V13' | 'V14' | 'V15' | 'V16'
  | 'V17' | 'V18' | 'V19' | 'V20' | 'V21' | 'V22' | 'V23' | 'V24';

/** Motion-behavior packs M01-M08. */
export type MotionPackId = 'M01' | 'M02' | 'M03' | 'M04' | 'M05' | 'M06' | 'M07' | 'M08';

/** Finish packs F01-F08. */
export type FinishPackId = 'F01' | 'F02' | 'F03' | 'F04' | 'F05' | 'F06' | 'F07' | 'F08';

/** Audio-treatment packs A01-A08. */
export type AudioPackId = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A06' | 'A07' | 'A08';

/** Style reference anchors (1-30). */
export type AnchorId =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20
  | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;

export type PackId = VisualPackId | MotionPackId | FinishPackId | AudioPackId;

// ---------------------------------------------------------------------------
// Pack descriptors
// ---------------------------------------------------------------------------

export interface Pack<Id extends string> {
  readonly id: Id;
  readonly name: string;
  /** The concrete, observable traits to inject into the planner prompt. */
  readonly directive: string;
}

export interface StyleAnchor {
  readonly id: AnchorId;
  readonly name: string;
  /** The concrete, observable traits -- translated from cultural/studio names. */
  readonly directive: string;
}

// ---------------------------------------------------------------------------
// Style strength scoring (G/S/P/M/T)
// ---------------------------------------------------------------------------

/**
 * Five axes for measuring style leverage against H3's photorealism default.
 *
 * A successful stress-test needs >= 3 axes active, with G or S required.
 * Prompts with only T + cadence collapse back to H3's default.
 */
export interface StrengthScore {
  /** Geometry / Material Change (clay, cutout, marble, liquid, Bauhaus). */
  G: boolean;
  /** Shape / Edge / Shadow Grammar (carved shadows, broken contours, posterized). */
  S: boolean;
  /** Palette / Value System (2-3 color limits, posterized ramps, UV blacklight). */
  P: boolean;
  /** Motion Grammar (snappy squash/stretch, rhythmic bounce, stepped holds). */
  M: boolean;
  /** Animated Texture / Process (line boil, paint crawl, pigment bleed, misregistration). */
  T: boolean;
}

export type StrengthLevel = 'subtle' | 'full' | 'stress-test';

// ---------------------------------------------------------------------------
// Creative mode system
// ---------------------------------------------------------------------------

export type CreativeMode = 'directed' | 'exploratory' | 'wild';

export interface CreativeSelection {
  visual?: VisualPackId | AnchorId;
  motion?: MotionPackId;
  finish?: FinishPackId;
  audio?: AudioPackId;
  strength: StrengthLevel;
}

/**
 * The output of the creative resolver: a text block ready to inject into
 * the planner system prompt, plus metadata for the UI and version history.
 */
export interface StyleInjection {
  /** The text block to insert into the planner system prompt. */
  styleDirective: string;
  /** Human-readable summary for UI display. */
  description: string;
  /** Which packs were selected. */
  selection: CreativeSelection;
  /** The creative mode that produced this selection. */
  mode: CreativeMode;
}

/** Stored on the document for version history. */
export interface CreativeModeRecord {
  mode: CreativeMode;
  selection: CreativeSelection;
}
