/**
 * Decomposing a rendered prompt into the parts something claims, and the parts
 * nothing does.
 *
 * Pure on purpose, and pure in the strong sense: no fs, no network, no DOM, no
 * contract.json. It takes a rendered string and a list of declared headings and
 * returns structure. That is what lets the same function run under a CLI, under
 * vitest, and inside the app if a prompt-editing screen ever wants it -- the
 * caller supplies the text and the declarations, and this decides nothing about
 * where either came from.
 *
 * It does not live in `src/core/` because it is not part of the compiler and
 * `test/purity.test.ts` guards that directory for a narrower reason. It lives
 * beside the builders it decomposes.
 *
 * WHY SPANS RATHER THAN A HEADING DIFF. Comparing the set of headings present
 * to the set declared catches a block that was declared and never written, and
 * misses text that sits before the first declared heading -- which is where the
 * most load-bearing sentence in the planner prompt actually is.
 * `test/contract.test.ts` slices each block from `text.indexOf(heading)`
 * forward, so a preamble is unreachable by it at any effort level. Marking the
 * span each block claims and reporting the leftover finds that case and the
 * heading cases together, from one mechanism.
 *
 * KEYED BY HEADING, NOT BY POSITION. Every result is addressed by its heading
 * string. Nothing here indexes a block by its position in an array, because a
 * position is not a name: inserting a block renumbers every block after it, and
 * anything holding a stored reference to "block 5" then points somewhere else.
 * A heading survives insertion, reordering and a spec edit that adds a
 * neighbour.
 *
 * SUBSTRING MATCHING IS THE HAZARD HERE. A heading is matched as a prefix, so
 * `# Active mode:` matches the rendered `# Active mode: T2VA`. That is
 * deliberate and it is also how this can go wrong: matching block *content* by
 * substring catches prose in a neighbouring block's note. Callers that want to
 * find a block should pass its heading, never a phrase from its body.
 */

/** One declared block, reduced to what decomposition actually needs. */
export interface DeclaredBlock {
  /** Matched as a prefix against headings in the rendered text. */
  heading: string;
  /** Present only so results can carry it back out; never matched on. */
  conditional?: boolean;
  asserts?: string[];
  noAnchor?: string;
  quotesOutput?: boolean;
  guide?: string;
  house?: boolean;
}

export interface BlockSpan {
  heading: string;
  start: number;
  end: number;
  chars: number;
  /** The block's own text, heading included. */
  text: string;
  declared: DeclaredBlock;
}

export interface UnclaimedSpan {
  start: number;
  end: number;
  text: string;
}

export interface Decomposition {
  /** Declared blocks found in the text, in the order they actually appear. */
  spans: BlockSpan[];
  /** Declared headings the text does not contain at all. */
  missing: string[];
  /** Headings the text carries that no declaration claims. */
  undeclared: string[];
  /** Ranges no declared block claims. Currently only a preamble can produce one. */
  unclaimed: UnclaimedSpan[];
  /** Declared order versus rendered order; false when a block moved. */
  inDeclaredOrder: boolean;
  /**
   * Blocks carrying no structural anchor.
   *
   * Worth surfacing separately because it is the set asserted only by wording,
   * or by nothing. `test/contract.test.ts` emits one generated case per member
   * -- the case that checks the block explains why it has no anchor -- so this
   * set is also the set whose tests no file names literally. Removing such a
   * block silently removes a test with it.
   */
  unanchored: string[];
}

/** Every `#`-prefixed heading line in a rendered prompt. */
export function headingsIn(text: string): { heading: string; at: number }[] {
  return [...text.matchAll(/^#+ .*$/gm)].map((m) => ({ heading: m[0], at: m.index ?? 0 }));
}

/**
 * Split a rendered prompt against the blocks a spec declares for it.
 *
 * Each found block runs from its own heading to whichever found heading comes
 * next, so the spans tile the text from the first heading to the end. Anything
 * before the first heading is claimed by nothing and comes back in `unclaimed`.
 */
export function decompose(text: string, blocks: readonly DeclaredBlock[]): Decomposition {
  const found: { block: DeclaredBlock; start: number }[] = [];
  const missing: string[] = [];

  // Scan forward so a heading string that recurs matches its own occurrence,
  // then fall back to a whole-string search so a block that merely moved is
  // reported as out of order rather than as absent.
  let cursor = 0;
  for (const block of blocks) {
    const ahead = text.indexOf(block.heading, cursor);
    if (ahead >= 0) {
      found.push({ block, start: ahead });
      cursor = ahead + block.heading.length;
      continue;
    }
    const anywhere = text.indexOf(block.heading);
    if (anywhere < 0) missing.push(block.heading);
    else found.push({ block, start: anywhere });
  }

  const declaredOrder = found.map((f) => f.block.heading);
  found.sort((a, b) => a.start - b.start);
  const inDeclaredOrder = found.every((f, i) => f.block.heading === declaredOrder[i]);

  const spans: BlockSpan[] = found.map((f, i) => {
    const end = i + 1 < found.length ? found[i + 1].start : text.length;
    return {
      heading: f.block.heading,
      start: f.start,
      end,
      chars: end - f.start,
      text: text.slice(f.start, end),
      declared: f.block,
    };
  });

  const undeclared = headingsIn(text)
    .filter((h) => !blocks.some((b) => h.heading.startsWith(b.heading)))
    .map((h) => h.heading);

  const unclaimed: UnclaimedSpan[] = [];
  const firstStart = spans.length ? spans[0].start : text.length;
  if (text.slice(0, firstStart).trim().length > 0) {
    unclaimed.push({ start: 0, end: firstStart, text: text.slice(0, firstStart).trim() });
  }

  const unanchored = blocks.filter((b) => (b.asserts?.length ?? 0) === 0).map((b) => b.heading);

  return { spans, missing, undeclared, unclaimed, inDeclaredOrder, unanchored };
}

/** Look a decomposed block up by heading. Never by position -- see the note above. */
export function blockNamed(d: Decomposition, heading: string): BlockSpan | undefined {
  return d.spans.find((s) => s.heading === heading);
}

export type Provenance =
  | { kind: 'guide'; cite: string }
  | { kind: 'house'; ids: string[] }
  | { kind: 'none' };

/**
 * Where a block's authority comes from.
 *
 * `ids` resolves to the `notInTheGuides` entries registered against the
 * BUILDER FILE, never against the block: those entries carry `paths`, a path
 * names a file, and one file holds many blocks. So this cannot say "the house
 * rule for this block" and does not pretend to -- the caller renders it as a
 * file-level list. That the spec has no block-level link is a finding about the
 * spec, not a gap to paper over with a plausible guess.
 */
export function provenanceOf(
  block: DeclaredBlock | undefined,
  builderPath: string,
  notInTheGuides: readonly { id: string; paths: string[] }[],
): Provenance {
  if (block?.guide) return { kind: 'guide', cite: block.guide };
  if (block?.house === true) {
    const ids = notInTheGuides.filter((i) => i.paths.some((p) => builderPath.startsWith(p))).map((i) => i.id);
    return { kind: 'house', ids };
  }
  return { kind: 'none' };
}

export function provenanceLabel(p: Provenance): string {
  if (p.kind === 'guide') return `guide: ${p.cite}`;
  if (p.kind === 'house') {
    return p.ids.length
      ? `house (file-level ids, not block-level: ${p.ids.join(', ')})`
      : 'house (NO notInTheGuides id for this file)';
  }
  return 'NO PROVENANCE';
}
