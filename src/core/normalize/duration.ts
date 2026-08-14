/**
 * Duration arithmetic.
 *
 * All of this is exact and none of it belongs in a prompt. The alignment line
 * carries a two-decimal duration, cut times are `MM:SS.mmm`, and frames convert
 * at a fixed rate -- a model asked to do this will mostly get it right, which is
 * the worst possible reliability profile for a value that appears in an exact
 * string.
 */

import { FPS, FRAME_BLOCK, FRAME_OFFSET } from '../ir/vocab';

/** Frames to seconds at the documented native rate. */
export function framesToSeconds(frames: number): number {
  return frames / FPS;
}

export function secondsToFrames(seconds: number): number {
  return Math.round(seconds * FPS);
}

/**
 * Duration as it appears in an alignment line: exactly two decimals.
 *
 * `toFixed` is correct here and the rounding it does is the rounding wanted --
 * 10.125s renders as "10.13", and the alignment line is a statement about the
 * target video, not a frame-accurate assertion.
 */
export function formatDuration(seconds: number): string {
  return seconds.toFixed(2);
}

/**
 * Cut time as it appears before a shot: `MM:SS.mmm`.
 *
 * Minutes are always two digits. The guide's own examples use `00:03.500` for a
 * three-and-a-half second cut, so short clips still carry the leading `00:`.
 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Cannot format timestamp from ${ms}`);
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.round(ms % 1000);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}

/** Parse `MM:SS.mmm` back to milliseconds. Returns null when the shape is wrong. */
export function parseTimestamp(text: string): number | null {
  const m = /^(\d{2}):(\d{2})\.(\d{3})$/.exec(text.trim());
  if (!m) return null;
  const [, mm, ss, mmm] = m;
  const seconds = Number(ss);
  if (seconds > 59) return null;
  return Number(mm) * 60_000 + seconds * 1000 + Number(mmm);
}

/**
 * Whether a frame count sits on the documented 17k+5 grid.
 *
 * This is a workflow fact, not a prompt fact, so it is advisory: a request that
 * misses the grid still produces a valid prompt, it just will not be the
 * duration that actually renders. Warning, never an error.
 */
export function isOnFrameGrid(frames: number): boolean {
  return frames >= FRAME_OFFSET && (frames - FRAME_OFFSET) % FRAME_BLOCK === 0;
}

/** Nearest legal frame count on the 17k+5 grid, rounding to the closer of the two. */
export function nearestGridFrames(frames: number): number {
  if (frames <= FRAME_OFFSET) return FRAME_OFFSET;
  const k = Math.round((frames - FRAME_OFFSET) / FRAME_BLOCK);
  return k * FRAME_BLOCK + FRAME_OFFSET;
}

/** Every legal frame count up to a ceiling. Used by the duration picker. */
export function gridFramesUpTo(maxFrames: number): number[] {
  const out: number[] = [];
  for (let k = 0; ; k += 1) {
    const frames = k * FRAME_BLOCK + FRAME_OFFSET;
    if (frames > maxFrames) break;
    out.push(frames);
  }
  return out;
}
