/**
 * Branch history.
 *
 * Checking out an older version and editing branches rather than overwrites,
 * which is what makes a wide edit safe to try: the previous state is always one
 * click away and the operation list says what changed.
 */

import type { VersionNode } from '../../db/versions';
import type { StoredVersion } from '../../db/db';

interface Props {
  nodes: VersionNode[];
  headId: string | null;
  onCheckout: (version: StoredVersion) => void;
}

export function VersionTree({ nodes, headId, onCheckout }: Props) {
  if (nodes.length === 0) {
    return <div className="p-3 text-xs text-[var(--color-muted)]">No versions yet.</div>;
  }

  return (
    <ul className="text-xs">
      {nodes.map((node) => {
        const isHead = node.version.id === headId;
        return (
          <li key={node.version.id}>
            <button
              type="button"
              onClick={() => onCheckout(node.version)}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-white/5 ${
                isHead ? 'bg-white/5' : ''
              }`}
              style={{ paddingLeft: `${12 + node.depth * 12}px` }}
            >
              <span className={isHead ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}>
                {isHead ? '●' : '○'}
              </span>
              <span className="flex-1 truncate">{node.version.label}</span>
              {node.version.operations.length > 0 && (
                <span className="text-[10px] text-[var(--color-muted)]">
                  {node.version.operations.length} edit{node.version.operations.length > 1 ? 's' : ''}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
