/**
 * The workspace.
 *
 * Three columns: what goes in, the document, and what comes out. The rendered
 * prompt on the right is never editable -- it is a view of the document, and
 * everything derived from it (alignment line, shot numbers, cut timestamps,
 * label ordinals) recomputes on every change.
 */

import { useState } from 'react';
import { useEngine } from './useEngine';
import { KeyPanel } from './KeyPanel';
import { DataPanel } from './DataPanel/DataPanel';
import { SlotManager } from './SlotManager/SlotManager';
import { DocumentEditor } from './DocumentEditor/DocumentEditor';
import { PromptView } from './PromptView/PromptView';
import { Diagnostics } from './Diagnostics/Diagnostics';
import { VersionTree } from './VersionTree/VersionTree';
import { MODES } from '../core/ir/vocab';
import { gridFramesUpTo } from '../core/normalize/duration';
import { modeRequirements } from '../core/normalize/mode';

const FRAME_CHOICES = gridFramesUpTo(24 * 15);

export function App() {
  const e = useEngine();
  const [instruction, setInstruction] = useState('');
  const [tab, setTab] = useState<'problems' | 'history'>('problems');

  const problemCount = e.view?.validation.diagnostics.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-edge)] px-4 py-2">
        <h1 className="text-sm font-semibold">H3 Transformation Engine</h1>
        <span className="text-[10px] text-[var(--color-muted)]">
          prompts as data &middot; MiniMax H3
        </span>
        <div className="flex-1" />
        <KeyPanel
          apiKey={e.apiKey}
          storedKeyMode={e.storedKeyMode}
          onSave={e.saveApiKey}
          onUnlock={e.unlockApiKey}
          onForget={e.forgetApiKey}
        />
        <DataPanel onErased={e.resetAfterErase} />
      </header>

      {(e.error || e.notice) && (
        <div
          className={`px-4 py-2 text-xs ${
            e.error ? 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]' : 'bg-white/5'
          }`}
        >
          {e.error ?? e.notice}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => (e.error ? e.setError(null) : e.setNotice(null))}
          >
            dismiss
          </button>
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* --- input ------------------------------------------------------ */}
        <aside className="min-h-0 space-y-4 overflow-y-auto border-r border-[var(--color-edge)] p-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Idea
            </label>
            <textarea
              value={e.idea}
              onChange={(ev) => e.setIdea(ev.target.value)}
              rows={5}
              placeholder="A baker opens the shutters of a small street bakery before sunrise."
              className="w-full resize-y rounded border border-[var(--color-edge)] bg-black/30 p-2 text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Mode
            </label>
            <select
              value={e.modeOverride ?? ''}
              onChange={(ev) => e.setModeOverride((ev.target.value || null) as never)}
              className="w-full rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
            >
              <option value="">Infer: {e.inference.mode}</option>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--color-muted)]">
              {e.modeOverride ? modeRequirements(e.mode).join(' ') : e.inference.reason}
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Duration
            </label>
            <select
              value={e.durationFrames ?? ''}
              onChange={(ev) => e.setFrames(ev.target.value ? Number(ev.target.value) : null)}
              className="w-full rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
            >
              {FRAME_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f} frames &middot; {(f / 24).toFixed(2)}s
                </option>
              ))}
              <option value="">seconds only (no frame grid)</option>
            </select>
            {e.durationFrames == null && (
              <input
                type="number"
                step={0.5}
                value={e.durationSeconds}
                onChange={(ev) => e.setDurationSeconds(Number(ev.target.value))}
                className="w-full rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
              />
            )}
            <p className="text-[10px] text-[var(--color-muted)]">
              Legal counts are 17k+5 at 24fps. Anything else the workflow snaps.
            </p>
          </div>

          <SlotManager slots={e.slots} onChange={e.setSlots} />

          <button
            type="button"
            onClick={() => void e.generate()}
            disabled={e.busy != null}
            className="w-full rounded bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-black disabled:opacity-40"
          >
            {e.busy ?? (e.doc ? 'Regenerate' : 'Generate')}
          </button>
        </aside>

        {/* --- document --------------------------------------------------- */}
        <section className="min-h-0 overflow-y-auto border-r border-[var(--color-edge)]">
          {e.doc ? (
            <DocumentEditor
              doc={e.doc}
              selectedPaths={e.selectedPaths}
              onSelect={e.togglePath}
              onCommit={(path, value) => void e.applyDirect(path, value)}
            />
          ) : (
            <div className="p-6 text-xs text-[var(--color-muted)]">
              Nothing yet. Describe a scene and generate: the result is a structured document, not a
              blob of text, so every part of it can be edited on its own afterwards.
            </div>
          )}
        </section>

        {/* --- output ----------------------------------------------------- */}
        <section className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--color-edge)] px-3 py-1.5 text-[10px]">
            <span className="text-[var(--color-muted)]">
              {e.view ? `${e.view.rendered.length} chars` : 'no output'}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => setTab('problems')}
              className={tab === 'problems' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}
            >
              {problemCount === 0 ? 'no problems' : `${problemCount} problem${problemCount > 1 ? 's' : ''}`}
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={tab === 'history' ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}
            >
              history
            </button>
            {e.view && (
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(e.view!.rendered.text)}
                className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 hover:bg-white/5"
              >
                copy
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {e.view ? (
              <PromptView
                text={e.view.rendered.text}
                map={e.view.rendered.map}
                diagnostics={e.view.validation.diagnostics}
                selectedPaths={e.selectedPaths}
                onSelect={e.togglePath}
              />
            ) : (
              <div className="p-6 text-xs text-[var(--color-muted)]">
                The rendered prompt appears here. Click any part of it to select the node behind it.
              </div>
            )}
          </div>

          {/* Assisted edit: the same mechanism whether one path or all of them. */}
          <div className="border-t border-[var(--color-edge)] p-2">
            <div className="mb-1 text-[10px] text-[var(--color-muted)]">
              {e.selectedPaths.length === 0
                ? 'Select part of the prompt or a field to edit it.'
                : `${e.selectedPaths.length} selected: ${e.selectedPaths.join(', ')}`}
            </div>
            <div className="flex gap-1">
              <input
                value={instruction}
                onChange={(ev) => setInstruction(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && instruction.trim()) {
                    void e.applyAssisted(instruction);
                    setInstruction('');
                  }
                }}
                placeholder="Make it night-time. Slow the camera. Cut the second line."
                className="flex-1 rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
              />
              <button
                type="button"
                disabled={e.busy != null || e.selectedPaths.length === 0}
                onClick={() => {
                  void e.applyAssisted(instruction);
                  setInstruction('');
                }}
                className="rounded border border-[var(--color-edge)] px-2 py-1 text-xs disabled:opacity-40"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!e.doc}
                onClick={() => e.setSelectedPaths(selectableFrom(e))}
                className="rounded border border-[var(--color-edge)] px-2 py-1 text-xs disabled:opacity-40"
                title="Select every editable prose field for a wide edit"
              >
                All
              </button>
            </div>
          </div>

          <div className="max-h-64 min-h-0 overflow-y-auto border-t border-[var(--color-edge)]">
            {tab === 'problems' ? (
              <Diagnostics
                diagnostics={e.view?.validation.diagnostics ?? []}
                onSelect={(path) => e.togglePath(path, false)}
              />
            ) : (
              <VersionTree nodes={e.versions} headId={e.headVersionId} onCheckout={(v) => void e.checkout(v)} />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

/** Every prose path in the document -- the target set for a wide edit. */
function selectableFrom(e: ReturnType<typeof useEngine>): string[] {
  if (!e.doc) return [];
  const paths = ['style', 'soundscape', 'music'];
  e.doc.shots.forEach((shot, i) => {
    shot.beats.forEach((_, j) => paths.push(`shots[${i}].beats[${j}].prose`));
  });
  e.doc.subjects.forEach((_, i) => paths.push(`subjects[${i}].traits`));
  return paths;
}
