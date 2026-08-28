/**
 * Wildcards: rolling, and the experiment matrix.
 *
 * The idea box above holds the template. This panel inserts category names into
 * it, rolls it, and shows the result -- but never writes the rolled text back,
 * because the template is what makes a second roll possible.
 *
 * Like the creative picker, it holds no state that belongs to the engine. The
 * seed lives in `useEngine`; the only local state here is which axis the matrix
 * is open on, which is a view concern and nothing else reads it.
 */

import { useState } from 'react';
import type { Matrix, RollResult } from '../../core/wildcards';
import {
  MATRIX_CELL_LIMIT,
  WILDCARDS,
  experimentMatrix,
  hasPlaceholders,
  placeholdersIn,
} from '../../core/wildcards';

interface WildcardPanelProps {
  idea: string;
  onIdeaChange: (next: string) => void;
  seed: number | null;
  rolled: RollResult | null;
  onRoll: () => void;
  onClearRoll: () => void;
  /** Send one matrix cell to the idea box, replacing the template. */
  onUseText: (text: string) => void;
}

export function WildcardPanel({
  idea,
  onIdeaChange,
  seed,
  rolled,
  onRoll,
  onClearRoll,
  onUseText,
}: WildcardPanelProps) {
  const [showMatrix, setShowMatrix] = useState(false);
  const present = hasPlaceholders(idea);
  const used = new Set(placeholdersIn(idea).map((p) => p.category));

  const matrix: Matrix | null = showMatrix && present ? experimentMatrix(idea) : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Wildcards
        </label>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!present}
            onClick={onRoll}
            className="rounded border border-[var(--color-edge)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-40"
          >
            {seed == null ? 'Roll' : 'Roll again'}
          </button>
          <button
            type="button"
            disabled={!present}
            aria-pressed={showMatrix}
            onClick={() => setShowMatrix((open) => !open)}
            className={`rounded border px-2 py-0.5 text-[10px] disabled:opacity-40 ${
              showMatrix
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
            }`}
          >
            Matrix
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {WILDCARDS.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.description}
            onClick={() => onIdeaChange(`${idea}${idea.endsWith(' ') || idea === '' ? '' : ' '}{${c.id}}`)}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              used.has(c.id)
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
            }`}
          >
            {c.id}
          </button>
        ))}
      </div>

      {!present && (
        <p className="text-[10px] text-[var(--color-muted)]">
          Put a name in braces anywhere in the idea, like {'{setting}'}, then roll it.
        </p>
      )}

      {rolled && (
        <div className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-2 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-[var(--color-accent)]">seed {seed}</span>
            <button
              type="button"
              onClick={onClearRoll}
              className="text-[10px] text-[var(--color-muted)] underline"
            >
              clear
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed">{rolled.text}</p>
          {rolled.unknown.length > 0 && (
            <p className="mt-1 text-[10px] text-[var(--color-muted)]">
              No category named {rolled.unknown.join(', ')}. Left as written.
            </p>
          )}
        </div>
      )}

      {matrix && <MatrixList matrix={matrix} onUseText={onUseText} />}
    </div>
  );
}

/**
 * Every combination, as ideas rather than as prompts.
 *
 * Compiling one is a model call, so the matrix stops at the text and the
 * decision to spend a call stays with the person pressing generate.
 */
function MatrixList({ matrix, onUseText }: { matrix: Matrix; onUseText: (text: string) => void }) {
  if (matrix.cells.length === 0) {
    return (
      <p className="text-[10px] text-[var(--color-muted)]">
        Nothing to vary. The matrix needs a category the library knows.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-[var(--color-muted)]">
        {matrix.cells.length} of {matrix.total} combination{matrix.total === 1 ? '' : 's'} across{' '}
        {matrix.axes.map((a) => a.category).join(' x ')}
        {matrix.truncated ? `. Capped at ${MATRIX_CELL_LIMIT}; narrow an axis to see the rest.` : '.'}
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {matrix.cells.map((cell) => (
          <button
            key={cell.text}
            type="button"
            onClick={() => onUseText(cell.text)}
            className="block w-full rounded border border-[var(--color-edge)] p-1.5 text-left text-[10px] hover:bg-white/5"
          >
            {cell.text}
          </button>
        ))}
      </div>
    </div>
  );
}
