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
                <label className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
                  cut at
                  <input
                    type="number"
                    step={100}
                    value={shot.cutAtMs ?? 0}
                    onChange={(e) => onCommit(`shots[${i}].cutAtMs`, Number(e.target.value))}
                    className="w-20 rounded bg-black/30 px-1 py-0.5 text-xs"
                  />
                  <span>ms = {formatTimestamp(shot.cutAtMs ?? 0)}</span>
                </label>
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
