/**
 * The prompt decomposition.
 *
 * Everything here runs against strings constructed in the test, never against a
 * real prompt. That is deliberate and it is the whole design of this file: an
 * assertion that `# Speech` is 3922 characters, or that the planner preamble
 * says what it currently says, is a change detector on prompt wording. It would
 * go red for every legitimate prompt edit and tell you nothing about whether
 * `decompose` works. The real prompts are the CLI's subject; the function's
 * contract is string-in, structure-out, and that is what is checked.
 *
 * The branches worth the most here are the ones the CLI never reaches against
 * the current tree: a block that moved rather than vanished, and a lookup by
 * heading. Both are live code paths that print or return findings, and neither
 * had ever been executed before this file existed.
 */

import { describe, expect, it } from 'vitest';

import { blockNamed, decompose, headingsIn, provenanceLabel, provenanceOf } from '../src/provider/prompts/inventory';
import type { DeclaredBlock } from '../src/provider/prompts/inventory';

const BLOCKS: DeclaredBlock[] = [
  { heading: '# One', asserts: ['alpha'] },
  { heading: '# Two', asserts: [] , noAnchor: 'prose with nothing to anchor on' },
  { heading: '# Three', asserts: ['gamma'] },
];

const prompt = ['# One', '', 'alpha body.', '', '# Two', '', 'beta body.', '', '# Three', '', 'gamma body.'].join('\n');

describe('decompose', () => {
  it('tiles the text: every span runs to the next heading, and the last to the end', () => {
    const d = decompose(prompt, BLOCKS);
    expect(d.spans.map((s) => s.heading)).toEqual(['# One', '# Two', '# Three']);
    // Contiguity is the property; the char counts themselves are incidental.
    for (const [i, s] of d.spans.entries()) {
      if (i + 1 < d.spans.length) expect(s.end).toBe(d.spans[i + 1].start);
    }
    expect(d.spans.at(-1)!.end).toBe(prompt.length);
    expect(d.spans.map((s) => s.text).join('')).toBe(prompt);
  });

  it('reports nothing unclaimed when the text opens on a declared heading', () => {
    expect(decompose(prompt, BLOCKS).unclaimed).toEqual([]);
  });

  /**
   * The finding the whole span design exists for, and the one a heading-set diff
   * cannot produce. Asserted on a constructed preamble so it stays true whatever
   * the real prompts say.
   */
  it('reports text before the first declared heading as unclaimed', () => {
    const withPreamble = `You are a thing.\n\nA second paragraph.\n\n${prompt}`;
    const d = decompose(withPreamble, BLOCKS);
    expect(d.unclaimed).toHaveLength(1);
    expect(d.unclaimed[0].start).toBe(0);
    expect(d.unclaimed[0].text).toContain('You are a thing.');
    expect(d.unclaimed[0].text).toContain('A second paragraph.');
    // It stops where the first block starts rather than swallowing it.
    expect(d.unclaimed[0].end).toBe(withPreamble.indexOf('# One'));
    expect(d.unclaimed[0].text).not.toContain('# One');
  });

  it('reports a declared block the text does not contain', () => {
    const d = decompose(prompt, [...BLOCKS, { heading: '# Four', asserts: ['delta'] }]);
    expect(d.missing).toEqual(['# Four']);
    expect(d.spans.map((s) => s.heading)).not.toContain('# Four');
  });

  it('reports a heading the text carries that nothing declares', () => {
    const d = decompose(`${prompt}\n\n# Extra\n\nbody.`, BLOCKS);
    expect(d.undeclared).toEqual(['# Extra']);
  });

  /**
   * The out-of-order path. `decompose` scans forward, so a block that moved
   * earlier is not found ahead of the cursor and falls back to a whole-string
   * search -- which is what separates "moved" from "absent". Nothing in the CLI
   * reaches this against the current tree, so without this case it is unproven
   * code that prints a finding.
   */
  it('separates a block that moved from a block that vanished', () => {
    const swapped = ['# Two', '', 'beta body.', '', '# One', '', 'alpha body.', '', '# Three', '', 'gamma body.'].join(
      '\n',
    );
    const d = decompose(swapped, BLOCKS);
    expect(d.missing).toEqual([]);
    expect(d.inDeclaredOrder).toBe(false);
    // Spans come back in rendered order, not declared order.
    expect(d.spans.map((s) => s.heading)).toEqual(['# Two', '# One', '# Three']);
  });

  it('reports declared order as satisfied when nothing moved', () => {
    expect(decompose(prompt, BLOCKS).inDeclaredOrder).toBe(true);
  });

  /** A heading is matched as a prefix, which is what lets `# Active mode:` find `# Active mode: T2VA`. */
  it('matches a declared heading as a prefix of the rendered one', () => {
    const d = decompose('# Active mode: T2VA\n\nbody.', [{ heading: '# Active mode:', asserts: ['body'] }]);
    expect(d.spans).toHaveLength(1);
    expect(d.undeclared).toEqual([]);
  });

  it('collects the blocks carrying no structural anchor', () => {
    expect(decompose(prompt, BLOCKS).unanchored).toEqual(['# Two']);
  });

  it('handles a prompt with no declared blocks at all', () => {
    const d = decompose('# Output format\n\nReply with JSON.', []);
    expect(d.spans).toEqual([]);
    expect(d.undeclared).toEqual(['# Output format']);
    expect(d.unclaimed).toHaveLength(1);
  });
});

describe('blockNamed', () => {
  it('finds a block by heading', () => {
    const d = decompose(prompt, BLOCKS);
    expect(blockNamed(d, '# Two')?.text).toContain('beta body.');
  });

  it('returns undefined for a heading that is not there', () => {
    expect(blockNamed(decompose(prompt, BLOCKS), '# Nope')).toBeUndefined();
  });
});

describe('headingsIn', () => {
  it('finds every heading level, and nothing that merely starts with a hash', () => {
    const text = '# One\n\nnot # a heading\n\n## Two\n';
    expect(headingsIn(text).map((h) => h.heading)).toEqual(['# One', '## Two']);
  });
});

describe('provenanceOf', () => {
  const items = [
    { id: 'thing-a', paths: ['src/provider/prompts/planner.ts'] },
    { id: 'thing-b', paths: ['src/provider/prompts/planner.ts'] },
    { id: 'elsewhere', paths: ['src/core/creative'] },
  ];

  it('prefers a guide citation', () => {
    const p = provenanceOf({ heading: '# X', guide: 'base 4.3' }, 'src/provider/prompts/planner.ts', items);
    expect(p).toEqual({ kind: 'guide', cite: 'base 4.3' });
  });

  /**
   * The imprecision is the point. `notInTheGuides` entries carry a file path and
   * a file holds many blocks, so this resolves to every id registered against
   * the builder -- it cannot say which one is "this block's" rule. The label
   * says so out loud rather than picking one, which is the named-proxy rule.
   */
  it('resolves house provenance to every id registered against the file, not to one block', () => {
    const p = provenanceOf({ heading: '# X', house: true }, 'src/provider/prompts/planner.ts', items);
    expect(p).toEqual({ kind: 'house', ids: ['thing-a', 'thing-b'] });
    expect(provenanceLabel(p)).toContain('file-level ids, not block-level');
  });

  it('says so when a house block has no registered id', () => {
    const p = provenanceOf({ heading: '# X', house: true }, 'src/provider/prompts/patch.ts', items);
    expect(p).toEqual({ kind: 'house', ids: [] });
    expect(provenanceLabel(p)).toContain('NO notInTheGuides id');
  });

  it('reports no provenance when a block cites nothing and declares nothing', () => {
    expect(provenanceOf({ heading: '# X' }, 'src/provider/prompts/planner.ts', items)).toEqual({ kind: 'none' });
    expect(provenanceLabel({ kind: 'none' })).toBe('NO PROVENANCE');
  });
});
