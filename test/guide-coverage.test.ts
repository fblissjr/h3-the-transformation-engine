/**
 * The guide-coverage ledger's consistency, in the suite.
 *
 * This file exists because the ledger did not have it. `scripts/guide-coverage.ts`
 * shipped as a CLI that exited nonzero on a fault and that nothing ever ran --
 * no `package.json` script, no test, no hook. Raised by the `dogman` session,
 * and it is the shape this repo keeps finding in itself: a guarantee held by
 * remembering to run something rather than by construction.
 *
 * WHAT IS ASSERTED AND WHAT IS NOT. Faults only. `consistencyProblems` covers a
 * guide that moved under the dispositions, a ledger and a spec pinned to
 * different text, a sentence with no entry, an entry matching no sentence, a
 * `covered` claim whose path does not resolve, and a `declined` with no reason.
 *
 * The BACKLOG is deliberately absent. 110 sentences are unverified as this is
 * written, and a test that failed on them would be red permanently, which is
 * the state people learn to scroll past -- the same reason
 * `scripts/prompt-inventory.ts` is not in the suite either. Unverified is work
 * not yet done; the list above is work done wrong.
 *
 * So the number this file does NOT watch is the one that should keep moving,
 * and the failures it does watch should never happen.
 */

import { describe, expect, it } from 'vitest';

import { consistencyProblems } from '../scripts/guide-coverage';

describe('the guide-coverage ledger', () => {
  it('is internally consistent, and says what is wrong when it is not', () => {
    expect(consistencyProblems()).toEqual([]);
  });

  /**
   * Guards the guard. `consistencyProblems` returning `[]` is only meaningful if
   * it had a ledger to read: a missing or empty pin would produce an empty list
   * from the wrong end, and the assertion above would pass over nothing. This is
   * the null-result trap the working notes keep naming -- a search that comes
   * back empty has established nothing unless it could have matched.
   */
  it('read a ledger with entries in it, so the check above is not vacuous', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const pin = JSON.parse(
      readFileSync(join(import.meta.dirname, '../reference/h3/guide-coverage.json'), 'utf8'),
    );
    expect(pin.entries.length).toBeGreaterThan(100);
    expect(pin.guides.length).toBe(2);
    // At least one real coverage claim, so the path-resolution branch is live
    // rather than skipped for want of anything to resolve.
    expect(pin.entries.filter((e: { disposition: string }) => e.disposition === 'covered').length)
      .toBeGreaterThan(0);
  });
});
