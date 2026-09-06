/**
 * The wiki harness, run by the suite rather than by whoever remembers.
 *
 * `wiki/verify.ts` has always been able to catch a wiki that describes code
 * which no longer exists. Nothing ran it. It was not in `bun run test`, not in
 * `bun run build`, and not in a hook -- so when the document store moved to
 * SQLite it went red and stayed red, citing `openHealed`, `ensureSchema` and
 * `highestSuffix`, none of which survive anywhere in the tree. Thirteen
 * failures, invisible for as long as nobody typed the command.
 *
 * That is the maintained-list-versus-construction split applied to a check
 * rather than to a guarantee: a control nothing runs is a control in name. The
 * fix is not a better harness, it is this file.
 *
 * Tiers 1 to 3 only. Tier 4 runs `tsc` and the test suite, so calling it from
 * inside the test suite would recurse.
 */

import { describe, expect, it } from 'vitest';
import {
  SRC_DIR,
  WIKI_DIR,
  verifyTier1,
  verifyTier2,
  verifyTier3,
  type TierResult,
} from '../wiki/verify';

const describeIssues = (result: TierResult) =>
  result.issues.map((i) => `${i.file ?? '?'}${i.line ? `:${i.line}` : ''}: ${i.message}`);

describe('the wiki describes code that exists', () => {
  it('tier 1: every expected article and subsystem is covered', () => {
    const result = verifyTier1(WIKI_DIR);
    expect(describeIssues(result)).toEqual([]);
  });

  it('tier 2: links, anchors and fences resolve', () => {
    const result = verifyTier2(WIKI_DIR);
    expect(describeIssues(result)).toEqual([]);
  });

  it('tier 3: every backticked symbol corresponds to real code', () => {
    // The one that went red on the storage move, and the reason this file
    // exists. It is also the tier that fails for a second, duller reason: a
    // symbol index that does not know about a directory reports every symbol
    // in it as unknown. `server/` was invisible here until it was added.
    const result = verifyTier3(WIKI_DIR, SRC_DIR);
    expect(describeIssues(result)).toEqual([]);
  });
});
