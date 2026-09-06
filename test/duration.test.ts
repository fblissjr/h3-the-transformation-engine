/**
 * The frame grid and the duration bounds.
 *
 * These functions had no tests at all, which is the reason the bug this file
 * was written for survived: the duration picker was built from the grid and a
 * ceiling with no floor, so it offered seven durations between 0.208s and
 * 4.458s against an engine floor of 5.0 seconds. Nothing caught it, and nothing
 * could have -- a short duration produces a perfectly valid prompt, so no
 * diagnostic fires, and no test existed to fail.
 *
 * The boundary cases below are the load-bearing ones. Asserting that every
 * returned value is at or above the floor would be a tautology -- it restates
 * the function's own filter against its own argument. Asserting which specific
 * grid step is the last excluded and which is the first included pins the
 * arithmetic, and would go red for an off-by-one in either direction.
 */

import { describe, expect, it } from 'vitest';

import { FPS, FRAME_BLOCK, FRAME_OFFSET, MIN_DURATION_SECONDS } from '../src/core/ir/vocab';
import {
  framesToSeconds,
  gridFramesBetween,
  isOnFrameGrid,
  nearestGridFrames,
  secondsToFrames,
} from '../src/core/normalize/duration';

const FLOOR_FRAMES = secondsToFrames(MIN_DURATION_SECONDS);

describe('the frame grid', () => {
  it('accepts 17k + 5 and rejects its neighbours', () => {
    expect(isOnFrameGrid(FRAME_OFFSET)).toBe(true);
    expect(isOnFrameGrid(FRAME_OFFSET + FRAME_BLOCK)).toBe(true);
    expect(isOnFrameGrid(FRAME_OFFSET + FRAME_BLOCK - 1)).toBe(false);
    expect(isOnFrameGrid(FRAME_OFFSET + FRAME_BLOCK + 1)).toBe(false);
  });

  it('rejects counts below the first grid value', () => {
    expect(isOnFrameGrid(FRAME_OFFSET - 1)).toBe(false);
    expect(isOnFrameGrid(0)).toBe(false);
  });

  it('rounds to the closer of the two neighbouring grid counts', () => {
    expect(nearestGridFrames(123)).toBe(124);
    expect(nearestGridFrames(130)).toBe(124);
    expect(nearestGridFrames(135)).toBe(141);
    // Below the first grid value there is only one direction to go.
    expect(nearestGridFrames(1)).toBe(FRAME_OFFSET);
  });
});

describe('gridFramesBetween', () => {
  /**
   * The regression. 107 frames is 4.458s and on-grid; 124 is 5.167s and the
   * first grid count at or above the 5.0s floor. The old function returned
   * both, because it counted from k = 0 and only checked the ceiling.
   */
  it('excludes the last grid step below the floor and starts at the first one above it', () => {
    const out = gridFramesBetween(FLOOR_FRAMES, FPS * 15);
    expect(out).not.toContain(107);
    expect(out[0]).toBe(124);
    expect(framesToSeconds(out[0])).toBeGreaterThanOrEqual(MIN_DURATION_SECONDS);
  });

  it('drops exactly the seven sub-floor options the picker used to offer', () => {
    const unbounded = gridFramesBetween(0, FPS * 15);
    const bounded = gridFramesBetween(FLOOR_FRAMES, FPS * 15);
    expect(unbounded.length - bounded.length).toBe(7);
    expect(unbounded.filter((f) => f < FLOOR_FRAMES)).toEqual([5, 22, 39, 56, 73, 90, 107]);
  });

  it('still honours the ceiling, and every value it returns is on the grid', () => {
    const out = gridFramesBetween(FLOOR_FRAMES, FPS * 15);
    expect(out.at(-1)).toBe(345);
    expect(out.every(isOnFrameGrid)).toBe(true);
  });

  it('returns nothing when the range excludes every grid value', () => {
    // 108..123 spans no 17k + 5 count.
    expect(gridFramesBetween(108, 123)).toEqual([]);
  });
});
