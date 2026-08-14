/**
 * The validator's output, as a jump list.
 *
 * Errors first, then warnings; clicking one selects the node it belongs to so
 * the editor and the rendered prompt both move to it.
 */

import type { Diagnostic } from '../../core/validate';

interface Props {
  diagnostics: Diagnostic[];
  onSelect: (path: string) => void;
}

export function Diagnostics({ diagnostics, onSelect }: Props) {
  if (diagnostics.length === 0) {
    return (
      <div className="p-3 text-xs text-[var(--color-muted)]">
        No problems. Every documented rule the format states is checked here.
      </div>
    );
  }

  const ordered = [...diagnostics].sort((a, b) =>
    a.severity === b.severity ? a.path.localeCompare(b.path) : a.severity === 'error' ? -1 : 1,
  );

  return (
    <ul className="divide-y divide-[var(--color-edge)]">
      {ordered.map((d, i) => (
        <li key={`${d.code}-${d.path}-${i}`}>
          <button
            type="button"
            onClick={() => onSelect(d.path)}
            className="w-full px-3 py-2 text-left hover:bg-white/5"
          >
            <div className="flex items-baseline gap-2">
              <span
                className={
                  d.severity === 'error'
                    ? 'text-[10px] font-semibold uppercase text-[var(--color-danger)]'
                    : 'text-[10px] font-semibold uppercase text-[var(--color-warn)]'
                }
              >
                {d.severity}
              </span>
              <code className="text-[10px] text-[var(--color-muted)]">{d.code}</code>
            </div>
            <div className="mt-0.5 text-xs leading-snug">{d.message}</div>
            {d.path && <code className="text-[10px] text-[var(--color-muted)]">{d.path}</code>}
          </button>
        </li>
      ))}
    </ul>
  );
}
