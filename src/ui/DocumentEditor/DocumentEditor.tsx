/**
 * The document as an editable tree.
 *
 * Every field here writes through the same patch gate a model edit uses, so a
 * typed change and an assisted change are indistinguishable downstream: both
 * validate, both re-render, both create a version.
 *
 * Derived values are shown read-only. Shot numbers and label ordinals follow
 * from position, and the moment they become typeable the alignment line can
 * disagree with the shots.
 */

import { useEffect, useState } from 'react';
import type { H3Document } from '../../core/ir/types';
import { AMPLITUDES, CAMERA_TYPES, SPEEDS } from '../../core/ir/vocab';
import { formatTimestamp } from '../../core/normalize/duration';

interface FieldProps {
  path: string;
  label: string;
  value: string;
  rows?: number;
  selected: boolean;
  onSelect: (path: string, additive: boolean) => void;
  onCommit: (path: string, value: string) => void;
}

/**
 * A text field that commits on blur rather than on every keystroke.
 *
 * Each commit creates a version, so committing per character would bury the
 * history under thousands of entries and make the branch tree useless.
 */
function Field({ path, label, value, rows = 2, selected, onSelect, onCommit }: FieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className={`rounded border p-2 ${selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-edge)]'}`}>
      <button
        type="button"
        onClick={(e) => onSelect(path, e.metaKey || e.ctrlKey || e.shiftKey)}
        className="mb-1 block w-full text-left"
      >
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      </button>
      <textarea
        value={draft}
        rows={rows}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(path, draft)}
        className="w-full resize-y rounded bg-black/30 p-1.5 text-xs leading-relaxed"
      />
    </div>
  );
}

/**
 * The draft a cut-time field starts from, given what the document holds.
 *
 * Empty for a shot with no cut time, and that emptiness is load-bearing rather
 * than cosmetic: the field used to seed from the `?? 0` it displays, so on a
 * shot carrying a live `SHOT_MISSING_TIMESTAMP` the draft was already "0" with
 * nothing typed, and merely tabbing through the field committed a cut at zero
 * -- erasing the diagnostic, writing a bogus `[Shot 2] At 00:00.000`, and
 * leaving a document that validates clean with nothing to say what happened.
 */
export function cutDraft(value: number | null): string {
  return value == null ? '' : String(value);
}

/**
 * What a blurred cut-time draft should write, or null for "write nothing".
 *
 * Exported because this is the whole of the decision and the UI around it is
 * unreachable from the suite. Two traps live here. `Number('')` is 0, so a
 * cleared field parsed with a bare `Number` writes a cut at zero rather than
 * leaving the value alone. And the comparison must read the stored value, not
 * the `?? 0` the input displays: a shot after the first with no cut time is a
 * live `SHOT_MISSING_TIMESTAMP`, and typing 0 into it is a real change.
 *
 * What it deliberately does not do is judge the number. Whether a cut time may
 * be fractional or negative is the document schema's answer, given once in
 * `H3DocumentSchema` and enforced for every writer by the shape gate in
 * `patch/apply.ts`; a copy of that rule here would be a second source for it.
 * Ordering and the end of the video stay with `validate/rules/timeline.ts`.
 */
export function cutCommit(draft: string, current: number | null): number | null {
  const trimmed = draft.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed === current ? null : parsed;
}

interface CutFieldProps {
  value: number | null;
  onCommit: (ms: number) => void;
}

/**
 * The cut time, committed on blur for the reason `Field` commits on blur.
 *
 * It wrote on every keystroke, so a four-digit value left four versions in the
 * history -- measured in the running app rather than reasoned about: seven
 * versions before typing `6300` one digit at a time into shot 2, eleven after,
 * the four new ones all labelled `Edited shots[1].cutAtMs`.
 *
 * The draft is a string so that backspacing to empty is representable; a
 * numeric draft turns an empty field into 0 and fights whoever is typing.
 */
function CutField({ value, onCommit }: CutFieldProps) {
  const [draft, setDraft] = useState(cutDraft(value));
  useEffect(() => setDraft(cutDraft(value)), [value]);

  return (
    <label className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
      cut at
      <input
        type="number"
        step={100}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // Enter blurs rather than committing directly, so blur stays the one
        // path a commit can come from.
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={() => {
          const next = cutCommit(draft, value);
          if (next == null) setDraft(cutDraft(value));
          else onCommit(next);
        }}
        className="w-20 rounded bg-black/30 px-1 py-0.5 text-xs"
      />
      {/* Reads the committed value, so it stops moving until the write lands,
          and says nothing rather than 00:00.000 for a shot that has no cut
          time -- the empty field beside it is the honest state. */}
      <span>{value == null ? 'no cut time yet' : `ms = ${formatTimestamp(value)}`}</span>
    </label>
  );
}

interface Props {
  doc: H3Document;
  selectedPaths: string[];
  onSelect: (path: string, additive: boolean) => void;
  onCommit: (path: string, value: unknown) => void;
}

export function DocumentEditor({ doc, selectedPaths, onSelect, onCommit }: Props) {
  const isSelected = (path: string) => selectedPaths.includes(path);
  const field = (path: string, label: string, value: string, rows?: number) => (
    <Field
      key={path}
      path={path}
      label={label}
      value={value}
      {...(rows != null ? { rows } : {})}
      selected={isSelected(path)}
      onSelect={onSelect}
      onCommit={onCommit}
    />
  );

  return (
    <div className="space-y-4 p-3">
      {field('style', 'Style', doc.style, 1)}

      {/* --- Ref2VA registries ------------------------------------------- */}
      {doc.mode === 'Ref2VA' && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Subjects
          </h3>
          {doc.subjects.map((subject, i) => (
            <div key={subject.id} className="space-y-1">
              <code className="text-[10px] text-[var(--color-accent)]">&lt;Subject {subject.ordinal}&gt;</code>
              {field(`subjects[${i}].traits`, 'Traits', subject.traits)}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase text-[var(--color-muted)]">Retention</span>
                <code className="text-[10px]">{subject.retention}</code>
              </div>
            </div>
          ))}
          {field('summary', 'Summary', doc.summary ?? '', 3)}
          <div className="text-[10px] text-[var(--color-muted)]">
            Task types: {doc.taskTypes?.join(' + ') || 'none'}
          </div>
        </section>
      )}

      {/* --- speakers ------------------------------------------------------ */}
      {doc.speakers.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Speakers
          </h3>
          {doc.speakers.map((speaker, i) => (
            <div key={speaker.id}>
              <code className="text-[10px] text-[var(--color-accent)]">(S{speaker.ordinal})</code>
              {field(`speakers[${i}].descriptor`, 'Voice', speaker.descriptor, 1)}
            </div>
          ))}
        </section>
      )}

      {/* --- shots --------------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Shots</h3>
        {doc.shots.map((shot, i) => (
          <div key={shot.id} className="rounded border border-[var(--color-edge)] p-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {/* Derived: position decides the number. */}
              <code className="text-xs text-[var(--color-accent)]">[Shot {shot.index}]</code>

              {i > 0 && (
                <CutField
                  key={shot.id}
                  value={shot.cutAtMs}
                  onCommit={(ms) => onCommit(`shots[${i}].cutAtMs`, ms)}
                />
              )}

            </div>

            {shot.camera && (
              <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px]">
                <span className="text-[var(--color-muted)]">camera</span>
                <select
                  value={shot.camera.type}
                  onChange={(e) => onCommit(`shots[${i}].camera.type`, e.target.value)}
                  className="rounded bg-black/30 px-1 py-0.5"
                >
                  {CAMERA_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={shot.camera.amplitude ?? ''}
                  onChange={(e) => onCommit(`shots[${i}].camera.amplitude`, e.target.value || undefined)}
                  className="rounded bg-black/30 px-1 py-0.5"
                >
                  <option value="">medium</option>
                  {AMPLITUDES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <select
                  value={shot.camera.speed ?? ''}
                  onChange={(e) => onCommit(`shots[${i}].camera.speed`, e.target.value || undefined)}
                  className="rounded bg-black/30 px-1 py-0.5"
                >
                  <option value="">normal</option>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <span className="text-[var(--color-muted)]">
                  changing this needs the prose to change too
                </span>
              </div>
            )}

            <div className="space-y-2">
              {shot.beats.map((beat, j) => (
                <div key={beat.id} className="space-y-1">
                  {field(`shots[${i}].beats[${j}].prose`, `Beat ${j + 1}`, beat.prose, 4)}
                  {beat.dialogue && (
                    <div className="pl-2">
                      {field(
                        `shots[${i}].beats[${j}].dialogue.text`,
                        `Dialogue${beat.dialogue.userSupplied ? ' (yours - locked to models)' : ''}`,
                        beat.dialogue.text,
                        1,
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {field('soundscape', 'Overall soundscape', doc.soundscape, 3)}
      {field('music', 'Non-diegetic music', doc.music, 2)}
    </div>
  );
}
