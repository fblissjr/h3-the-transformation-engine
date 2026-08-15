/**
 * Local data: what is stored, and the button that removes it.
 *
 * Two things make a delete button trustworthy, and this has both. It says what
 * is there before you press it, and afterwards it reports counts re-read from
 * storage rather than an assumption that the call worked. A before-and-after of
 * `12 -> 0` is evidence; a green "Done" is a promise.
 *
 * Two scopes rather than one, because "clear my history" and "forget my API
 * key" are different intentions and merging them means someone gets an outcome
 * they did not ask for. Each confirms on a second click -- not `window.confirm`,
 * which is a modal that blocks the page and reads as a browser warning rather
 * than a decision about this app.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  describeResidue,
  erase,
  residueTotal,
  survey,
  type EraseReport,
  type EraseScope,
  type Residue,
} from '../../db/wipe';

interface Props {
  onErased: (scope: EraseScope) => void;
}

const SCOPE_LABEL: Record<EraseScope, string> = {
  documents: 'Erase documents and history',
  everything: 'Erase everything, including the key',
};

const SCOPE_DETAIL: Record<EraseScope, string> = {
  documents: 'Removes the workspace, every saved version, and settings. Your API key stays.',
  everything:
    'The above, plus every stored secret and the wrapping key that decrypts them. Anything still holding that ciphertext becomes unreadable.',
};

export function DataPanel({ onErased }: Props) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<Residue | null>(null);
  const [armed, setArmed] = useState<EraseScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EraseReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCurrent(await survey());
      setFailure(null);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const run = useCallback(
    async (scope: EraseScope) => {
      setBusy(true);
      setArmed(null);
      setFailure(null);
      try {
        const result = await erase(scope);
        setReport(result);
        setCurrent(result.after);
        // The in-memory document has to go too. Leaving it on screen next to a
        // report saying the database is empty is exactly the contradiction that
        // makes people distrust the readout.
        onErased(scope);
      } catch (cause) {
        // A throw here means the erase did not finish, which the user must not
        // read as success.
        setReport(null);
        setFailure(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [onErased],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--color-edge)] px-2 py-1 text-[10px] text-[var(--color-muted)] hover:bg-white/5"
        title="What this app has stored on this machine, and how to erase it"
      >
        local data
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close local data panel"
        className="fixed inset-0 z-10 cursor-default bg-black/50"
      />
      <div className="fixed right-4 top-12 z-20 w-[26rem] rounded border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 text-xs shadow-xl">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="font-semibold">Local data</h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] text-[var(--color-muted)] underline"
          >
            close
          </button>
        </div>

        <p className="mb-3 text-[10px] leading-relaxed text-[var(--color-muted)]">
          All of it is in this browser, on this machine. There is no account and no server, so
          nothing here is reachable over the network and nothing but you removes it.
        </p>

        {failure && (
          <p className="mb-2 rounded bg-[var(--color-danger)]/15 px-2 py-1 text-[10px] text-[var(--color-danger)]">
            {failure}
          </p>
        )}

        <Inventory residue={current} />

        <div className="mt-3 space-y-2">
          {(['documents', 'everything'] as const).map((scope) => (
            <div key={scope}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (armed === scope ? void run(scope) : setArmed(scope))}
                onBlur={() => setArmed((a) => (a === scope ? null : a))}
                className={`w-full rounded border px-2 py-1.5 text-left text-xs disabled:opacity-40 ${
                  armed === scope
                    ? 'border-[var(--color-danger)] bg-[var(--color-danger)]/20 text-[var(--color-danger)]'
                    : 'border-[var(--color-edge)] hover:bg-white/5'
                }`}
              >
                {armed === scope ? `Confirm: ${SCOPE_LABEL[scope].toLowerCase()}` : SCOPE_LABEL[scope]}
              </button>
              <p className="mt-0.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
                {SCOPE_DETAIL[scope]}
              </p>
            </div>
          ))}
        </div>

        {busy && <p className="mt-3 text-[10px] text-[var(--color-muted)]">Erasing and re-reading storage.</p>}
        {report && !busy && <Verification report={report} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const ROW_LABEL: Record<string, string> = {
  documents: 'documents',
  versions: 'saved versions',
  settings: 'settings',
  vaultKeys: 'wrapping key',
  secrets: 'stored secrets',
};

/** Flatten a residue into label/count pairs so before and after line up. */
function countsOf(residue: Residue): [string, number][] {
  return [
    ['documents', residue.rows.documents],
    ['versions', residue.rows.versions],
    ['settings', residue.rows.settings],
    ['vaultKeys', residue.vaultKeys],
    ['secrets', residue.secrets.length],
  ];
}

function Inventory({ residue }: { residue: Residue | null }) {
  if (!residue) return <p className="text-[10px] text-[var(--color-muted)]">Reading storage.</p>;

  return (
    <div className="rounded border border-[var(--color-edge)] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        Stored now
      </div>
      <dl className="space-y-0.5">
        {countsOf(residue).map(([key, count]) => (
          <div key={key} className="flex justify-between">
            <dt className="text-[var(--color-muted)]">{ROW_LABEL[key]}</dt>
            <dd className="tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      {residueTotal(residue) === 0 && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">Nothing stored.</p>
      )}
    </div>
  );
}

/**
 * The receipt.
 *
 * Both columns are shown deliberately. `0 -> 0` demonstrates nothing, so the
 * before column is what tells the user the erase had something to do; the after
 * column is a fresh read, not a restatement of the intent.
 */
function Verification({ report }: { report: EraseReport }) {
  const before = countsOf(report.before);
  const after = countsOf(report.after);
  const leftover = describeResidue(report.after, report.scope);

  return (
    <div
      className={`mt-3 rounded border p-2 ${
        report.clean ? 'border-[var(--color-edge)]' : 'border-[var(--color-danger)]'
      }`}
    >
      <div className="mb-1 font-semibold">
        {report.clean
          ? report.scope === 'everything'
            ? 'Erased everything.'
            : 'Erased documents and history.'
          : 'Incomplete erase.'}
      </div>

      <dl className="space-y-0.5">
        {before.map(([key, was], i) => {
          const now = after[i][1];
          const inScope = report.scope === 'everything' || (key !== 'vaultKeys' && key !== 'secrets');
          return (
            <div key={key} className="flex justify-between">
              <dt className={inScope ? 'text-[var(--color-muted)]' : 'text-[var(--color-muted)]/50'}>
                {ROW_LABEL[key]}
                {!inScope && ' (kept)'}
              </dt>
              <dd className="tabular-nums">
                {was} &rarr; <span className={now > 0 && inScope ? 'text-[var(--color-danger)]' : ''}>{now}</span>
              </dd>
            </div>
          );
        })}
      </dl>

      {report.clean ? (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-muted)]">
          Counts re-read from storage after the delete, not assumed. Browser history, the disk
          cache, and anything already sent to Google are outside this app and unaffected.
        </p>
      ) : (
        <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-danger)]">
          {leftover ? `Still present: ${leftover}.` : 'The delete did not complete.'}
          {report.blocked.length > 0 &&
            ` Blocked by another open tab (${report.blocked.join(', ')}) -- close other tabs of this app and run it again.`}
        </p>
      )}
    </div>
  );
}
