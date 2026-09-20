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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The governing documents point at files that exist.
 *
 * CLAUDE.md and README.md are the first things read in a session, and between
 * them they name three dozen source files, tests and scripts. That list is
 * maintained by hand and nothing guarded it, so a rename anywhere in `src/`
 * silently invalidated a pointer in the file whose whole job is to tell the
 * next reader where to look.
 *
 * Why it is worth a check with zero current rot: a dead pointer is invisible
 * until someone follows it, and each one raises the expected cost of looking
 * anything up. Past some threshold re-deriving a thing becomes cheaper than
 * finding it, which is how a repo with a wiki, a contract and a rule table ends
 * up rebuilding what it already has. A sibling project measured six dead
 * script references in its own rule tables; this repo shipped a dangling
 * contract citation earlier today and caught it by eye.
 *
 * Shorthand resolves, and that is deliberate rather than lax. These documents
 * write `vocab.ts` and `validate/rules/speech.ts` for files whose full paths
 * are long, and demanding repo-relative form everywhere would make the check
 * fire on prose that is doing its job. A reference passes if it names exactly
 * one tracked file by full path or by unique suffix; an AMBIGUOUS result is
 * reported too, since a shorthand matching two files points at neither.
 *
 * The proxy, named: this asks whether the file exists, not whether it is the
 * right one to cite. `notInTheGuides` made exactly that mistake once -- it
 * checked a path existed while pointing at the wrong file.
 */
describe('the governing documents point at files that exist', () => {
  /**
   * The extension list is the scoping mechanism, and it is load-bearing.
   *
   * It looks like an arbitrary convenience and is the reason this check is
   * cheap. These documents cite file-shaped things from four different worlds:
   * this repository, another machine's server config (`models.toml`), a
   * hostname, and code expressions that look like dotted paths
   * (`doc.roll`, `record.doc.shots.length`, `interactions.delete`). A resolver
   * that recognised "a path" would report all of those as unresolved, and the
   * only fix would be teaching it which root each one hangs from -- which is
   * the expensive half, and the reason a repo-relative convention is what makes
   * this style of check affordable elsewhere.
   *
   * So the list is an allowlist that grants coverage, pinned deliberately:
   * every extension here belongs to a file this repository tracks. Widening it
   * is not a tidy-up, it is a commitment to resolving foreign roots. `html` and
   * `lock` were added after an audit found `index.html` and `bun.lock` cited
   * and unchecked -- real false negatives the original list dropped silently,
   * which is the same shape as the foreign roots it drops correctly.
   */
  const REFERENCE = /`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|json|md|py|html|lock))`/g;

  /**
   * Cited files that exist here and are outside the repository, per document.
   *
   * `internal/` is gitignored, so this note is followable by whoever wrote it
   * and by nobody else -- a failure invisible to exactly the person who can
   * follow it. The citation in CLAUDE.md says so in line, and this pins the
   * set so a second one has to be added deliberately.
   */
  const UNSHARED: Record<string, string[]> = {
    'CLAUDE.md': ['internal/prompt-audit_2026-09-06.md'],
    'README.md': [],
  };

  for (const doc of ['CLAUDE.md', 'README.md']) {
    it(`${doc} names only files that resolve`, () => {
      const root = join(import.meta.dirname, '..');
      const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
      const text = readFileSync(join(root, doc), 'utf8');

      const refs = new Map<string, number>();
      for (const m of text.matchAll(REFERENCE)) {
        if (!refs.has(m[1])) refs.set(m[1], text.slice(0, m.index).split('\n').length);
      }
      // Not vacuous: these documents do cite files, and a pattern that stopped
      // matching would leave the assertion below green over an empty set.
      expect(refs.size, `${doc} cites no files, so this asserts nothing`).toBeGreaterThan(10);

      const unresolved: string[] = [];
      const untracked: string[] = [];
      for (const [ref, line] of refs) {
        const hits = tracked.filter((f) => f === ref || f.endsWith(`/${ref}`));
        if (hits.length > 1) unresolved.push(`${doc}:${line} ${ref} is ambiguous (${hits.length} files)`);
        else if (hits.length === 1) continue;
        // Present on this machine but outside the repository. A different
        // failure from rot and it wants a different fix, so it is separated
        // rather than folded in: the pointer is followable by whoever wrote it
        // and by nobody else, which is invisible precisely to the person who
        // can follow it.
        else if (existsSync(join(root, ref))) untracked.push(ref);
        else unresolved.push(`${doc}:${line} ${ref} resolves to no tracked file`);
      }
      expect(unresolved).toEqual([]);
      // Pinned, and an allowlist that grants is the safe direction to pin: a
      // new unshared pointer has to be added here deliberately. The citation
      // itself says the file is unshared, so a reader does not go hunting.
      expect(untracked.sort()).toEqual(UNSHARED[doc]);
    });
  }
});
