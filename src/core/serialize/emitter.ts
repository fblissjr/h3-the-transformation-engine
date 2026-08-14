/**
 * A string builder that records where each document node landed.
 *
 * The source map is the feature. With it, a click anywhere in the rendered
 * prompt resolves to the IR node that produced those characters, a validator
 * diagnostic highlights the exact offending span, and a version diff can be
 * computed per node instead of per line. Without it the rendered prompt is an
 * opaque blob and "prompts as data" stays a slogan.
 *
 * Spans nest. `shots[0]` contains `shots[0].beats[1].prose`, and both are
 * recorded, so a lookup can pick the innermost span covering an offset.
 */

export interface SourceSpan {
  /** Document path, matching the syntax in core/ir/paths.ts. */
  path: string;
  /** Inclusive start offset into the rendered text. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

export class Emitter {
  private chunks: string[] = [];
  private length = 0;
  private spans: SourceSpan[] = [];

  /** Append text without attributing it to any node. Scaffolding only. */
  write(text: string): this {
    if (text === '') return this;
    this.chunks.push(text);
    this.length += text.length;
    return this;
  }

  /** Append text attributed to a document path. */
  writeAt(path: string, text: string): this {
    const start = this.length;
    this.write(text);
    if (this.length > start) {
      this.spans.push({ path, start, end: this.length });
    }
    return this;
  }

  /**
   * Attribute everything written inside `body` to `path`.
   *
   * Used for container nodes: a shot's span covers its header, its timestamp,
   * and all of its beats, while each beat records its own narrower span inside.
   */
  block(path: string, body: () => void): this {
    const start = this.length;
    body();
    if (this.length > start) {
      this.spans.push({ path, start, end: this.length });
    }
    return this;
  }

  newline(count = 1): this {
    return this.write('\n'.repeat(count));
  }

  /** Current offset, for callers that need to measure a region themselves. */
  get offset(): number {
    return this.length;
  }

  build(): { text: string; map: SourceSpan[] } {
    return {
      text: this.chunks.join(''),
      // Outermost first, then by position. Lets a lookup walk to the innermost
      // match by simply taking the last hit.
      map: [...this.spans].sort((a, b) => a.start - b.start || b.end - a.end),
    };
  }
}

/**
 * The innermost span covering an offset.
 *
 * Returns undefined in the gaps -- section headers, blank lines and other pure
 * scaffolding belong to no node, and inventing an owner for them would make a
 * click on a blank line select something arbitrary.
 */
export function spanAt(map: SourceSpan[], offset: number): SourceSpan | undefined {
  let best: SourceSpan | undefined;
  for (const span of map) {
    if (span.start > offset) break;
    if (offset < span.end) {
      if (!best || span.end - span.start <= best.end - best.start) best = span;
    }
  }
  return best;
}

/** Every span recorded for a path. A path can appear once; containers cover more. */
export function spansFor(map: SourceSpan[], path: string): SourceSpan[] {
  return map.filter((s) => s.path === path);
}

/** The character range a path occupies, or undefined when it rendered nothing. */
export function rangeOf(map: SourceSpan[], path: string): { start: number; end: number } | undefined {
  const own = spansFor(map, path);
  if (own.length === 0) return undefined;
  return {
    start: Math.min(...own.map((s) => s.start)),
    end: Math.max(...own.map((s) => s.end)),
  };
}
