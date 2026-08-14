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
        No problems. Only hard contract violations are reported here.
      </div>
    );
  }

  const ordered = [...diagnostics].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <ul className="divide-y divide-[var(--color-edge)]">
      {ordered.map((d, i) => (
        <li key={`${d.code}-${d.path}-${i}`}>
          <button
            type="button"
            onClick={() => onSelect(d.path)}
            className="w-full px-3 py-2 text-left hover:bg-white/5"
          >
            <code className="text-[10px] text-[var(--color-danger)]">{d.code}</code>
            <div className="mt-0.5 text-xs leading-snug">{d.message}</div>
            {d.path && <code className="text-[10px] text-[var(--color-muted)]">{d.path}</code>}
          </button>
        </li>
      ))}
    </ul>
  );
}
