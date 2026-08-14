/**
 * The rendered prompt, linked back to the document.
 *
 * This is the feature the source map exists for. Every character in the output
 * either belongs to a document node or is scaffolding, so clicking a sentence
 * selects the beat that produced it and a diagnostic underlines the exact
 * characters at fault.
 */

import { useMemo } from 'react';
import type { SourceSpan } from '../../core/serialize';
import type { Diagnostic } from '../../core/validate';

interface Segment {
  text: string;
  path: string | null;
  start: number;
}

/**
 * Cut the text at every span boundary, then attribute each piece to the
 * innermost span covering it.
 *
 * Segmenting on boundaries rather than walking spans directly is what makes
 * nesting work: a shot's span and its beat's span overlap, and the beat must
 * win inside its own range without losing the shot's ownership either side.
 */
function segment(text: string, map: SourceSpan[]): Segment[] {
  if (map.length === 0) return [{ text, path: null, start: 0 }];

  const boundaries = new Set<number>([0, text.length]);
  for (const span of map) {
    boundaries.add(span.start);
    boundaries.add(span.end);
  }
  const cuts = [...boundaries].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end <= start) continue;

    let innermost: SourceSpan | null = null;
    for (const span of map) {
      if (span.start <= start && span.end >= end) {
        if (!innermost || span.end - span.start <= innermost.end - innermost.start) innermost = span;
      }
    }
    segments.push({ text: text.slice(start, end), path: innermost?.path ?? null, start });
  }
  return segments;
}

interface Props {
  text: string;
  map: SourceSpan[];
  diagnostics: Diagnostic[];
  selectedPaths: string[];
  onSelect: (path: string, additive: boolean) => void;
}

export function PromptView({ text, map, diagnostics, selectedPaths, onSelect }: Props) {
  const segments = useMemo(() => segment(text, map), [text, map]);

  const failingPaths = useMemo(() => new Set(diagnostics.map((d) => d.path)), [diagnostics]);

  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  return (
    <div className="prompt-text p-4">
      {segments.map((seg) => {
        if (!seg.path) {
          return (
            <span key={seg.start} className="text-[var(--color-muted)]">
              {seg.text}
            </span>
          );
        }
        const classes = [
          'cursor-pointer',
          selected.has(seg.path) ? 'span-hit' : '',
          failingPaths.has(seg.path) ? 'span-error' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <span
            key={seg.start}
            className={classes}
            title={seg.path}
            onClick={(e) => onSelect(seg.path!, e.metaKey || e.ctrlKey || e.shiftKey)}
          >
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}
