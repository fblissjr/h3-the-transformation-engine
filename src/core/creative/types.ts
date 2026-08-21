/**
 * Shared types for the creative mode system.
 *
 * Creative modes inject structured style directives into the planner's system
 * prompt. They affect what the LLM is asked to write, not how the serializer
 * formats it. The deterministic pipeline stays untouched.
 *
 * The id unions are not written out here. They are derived from the pack
 * tables themselves, so a pack cannot exist in the data and be missing from
 * the type, or the other way round.
 */

import type { MotionPackId, FinishPackId, AudioPackId } from './packs';
import type { VisualId } from './visual';

export type { Axis, PackDef, VisualPackId, MotionPackId, FinishPackId, AudioPackId } from './packs';
export type { AnchorId } from './anchors';
export type { VisualId } from './visual';

// ---------------------------------------------------------------------------
// Style strength
// ---------------------------------------------------------------------------

/**
 * How far the style direction reaches into the scene.
 *
 * This is a scope, not a volume knob. `subtle` means the direction governs the
 * medium and finish and leaves the rest of the request alone; `full` means it
 * governs every visual layer; `stress-test` adds the density of reinforcing
 * structural detail that keeps a strong style from collapsing back toward
 * photorealism.
 */
export type StrengthLevel = 'subtle' | 'full' | 'stress-test';

/**
 * Which of the five leverage axes a combination activates.
 *
 * A combination that reads as a genuine style change rather than a filter
 * needs at least three axes with G or S among them; see `strength.ts`.
 */
export interface StrengthScore {
  G: boolean;
  S: boolean;
  P: boolean;
  M: boolean;
  T: boolean;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type CreativeMode = 'directed' | 'exploratory' | 'wild';

/**
 * A selection as it may arrive from storage.
 *
 * The ids are bare strings because a stored document can name a pack that this
 * build renamed or dropped. The derivations take this shape rather than the
 * strict one, so tolerating an unknown id is a stated part of their contract
 * instead of a cast at every call site that has to deal with storage.
 */
export interface StoredSelection {
  visual?: string;
  motion?: string;
  finish?: string;
  audio?: string;
  strength: StrengthLevel;
}

/** A selection built by code, where every id is known to exist. */
export interface CreativeSelection extends StoredSelection {
  visual?: VisualId;
  motion?: MotionPackId;
  finish?: FinishPackId;
  audio?: AudioPackId;
}

/**
 * The whole of what a creative mode contributes, and the only form of it that
 * travels or is persisted.
 *
 * The directive text and the display label are both pure functions of this
 * record (`styleDirective`, `describeSelection`). Neither is stored, because a
 * stored copy of a derived string is a copy that can disagree with its input --
 * the same reason `serialize(doc, ctx)` is the only writer of prompt text.
 */
export interface CreativeModeRecord {
  mode: CreativeMode;
  selection: CreativeSelection;
}
