/**
 * Reference slots.
 *
 * Each attached asset gets a role, and the role is what decides everything
 * downstream: which label kind it carries, whether it earns a standalone
 * definition line, and -- across all slots together -- which mode this is.
 *
 * The derived label is shown but never editable. Ordinals follow connection
 * order and are recomputed on every change; letting a user type one would let
 * the prompt cite a label the workflow will not supply.
 */

import { useCallback, useRef, useState } from 'react';
import type { ReferenceSlot } from '../../core/ir/types';
import {
  AUDIO_ROLES,
  FRAME_ANCHOR_ROLES,
  SLOT_CEILINGS,
  SUBJECT_CONTENT_ROLES,
  VIDEO_STRUCTURE_ROLES,
  type MediaKind,
  type SlotRole,
} from '../../core/ir/vocab';
import { assignLabels, countByKind } from '../../core/normalize/labels';

const ROLES_FOR: Record<MediaKind, readonly SlotRole[]> = {
  image: [...FRAME_ANCHOR_ROLES, ...SUBJECT_CONTENT_ROLES],
  video: [...VIDEO_STRUCTURE_ROLES, ...SUBJECT_CONTENT_ROLES, ...AUDIO_ROLES],
  audio: AUDIO_ROLES,
};

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

interface Props {
  slots: ReferenceSlot[];
  onChange: (slots: ReferenceSlot[]) => void;
  canAnalyzeVideo?: boolean;
  onAnalyzeVideo?: (
    file: File,
    onProgress?: (msg: string) => void,
  ) => Promise<{ description: string; uri: string }>;
}

export function SlotManager({ slots, onChange, canAnalyzeVideo, onAnalyzeVideo }: Props) {
  const labels = assignLabels(slots);
  const counts = countByKind(slots);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  const [analyzingStatus, setAnalyzingStatus] = useState<Record<string, string>>({});
  const [analyzeError, setAnalyzeError] = useState<Record<string, string>>({});
  const filePickerRef = useRef<HTMLInputElement>(null);
  const pendingSlotIdRef = useRef<string | null>(null);

  const update = useCallback(
    (id: string, patch: Partial<ReferenceSlot>) => {
      onChange(slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    },
    [slots, onChange],
  );

  const runAnalysis = useCallback(
    async (slotId: string, file: File) => {
      if (!onAnalyzeVideo) return;
      setAnalyzeError((prev: Record<string, string>) => {
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
      try {
        const res = await onAnalyzeVideo(file, (msg) => {
          setAnalyzingStatus((prev: Record<string, string>) => ({ ...prev, [slotId]: msg }));
        });
        update(slotId, { description: res.description });
      } catch (err) {
        setAnalyzeError((prev: Record<string, string>) => ({
          ...prev,
          [slotId]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setAnalyzingStatus((prev: Record<string, string>) => {
          const next = { ...prev };
          delete next[slotId];
          return next;
        });
      }
    },
    [onAnalyzeVideo, update],
  );

  const add = useCallback(
    async (files: FileList) => {
      const next = [...slots];
      for (const file of Array.from(files)) {
        const kind = kindOf(file);
        if (!kind) continue;

        const slotId = `slot-${Date.now()}-${next.length}`;
        fileMapRef.current.set(slotId, file);

        const dataUrl =
          kind === 'image'
            ? await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.readAsDataURL(file);
              })
            : undefined;

        next.push({
          id: slotId,
          order: next.length,
          kind,
          roles: [],
          filename: file.name,
          mimeType: file.type,
          ...(dataUrl ? { dataUrl } : {}),
          description: '',
        });
      }
      onChange(next);
    },
    [slots, onChange],
  );

  const remove = useCallback(
    (id: string) => {
      fileMapRef.current.delete(id);
      // Reindex so connection order stays contiguous; ordinals are positional.
      onChange(slots.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
    },
    [slots, onChange],
  );

  const move = useCallback(
    (id: string, delta: number) => {
      const index = slots.findIndex((s) => s.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= slots.length) return;
      const next = [...slots];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next.map((s, i) => ({ ...s, order: i })));
    },
    [slots, onChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          References
        </h2>
        <label className="cursor-pointer rounded border border-[var(--color-edge)] px-2 py-1 text-xs hover:bg-white/5">
          Attach
          <input
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(e) => e.target.files && void add(e.target.files)}
          />
        </label>
      </div>

      <p className="text-[10px] text-[var(--color-muted)]">
        {counts.image}/{SLOT_CEILINGS.image} images, {counts.video}/{SLOT_CEILINGS.video} video,{' '}
        {counts.audio}/{SLOT_CEILINGS.audio} audio. Connection order sets the label numbers.
      </p>

      {slots.length === 0 && (
        <p className="rounded border border-dashed border-[var(--color-edge)] p-3 text-xs text-[var(--color-muted)]">
          No references. That is text-to-video: the whole timeline comes from your description.
        </p>
      )}

      <ul className="space-y-2">
        {slots.map((slot, i) => {
          const own = labels.filter((l) => l.slotId === slot.id);
          return (
            <li key={slot.id} className="rounded border border-[var(--color-edge)] bg-[var(--color-panel)] p-2">
              <div className="flex items-start gap-2">
                {slot.dataUrl ? (
                  <img src={slot.dataUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-black/40 text-[10px] uppercase text-[var(--color-muted)]">
                    {slot.kind}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    {own.map((l) => (
                      <code key={l.ref} className="text-[10px] text-[var(--color-accent)]">
                        {l.ref}
                        {!l.standalone && <span className="text-[var(--color-muted)]"> (in a Subject)</span>}
                      </code>
                    ))}
                    {own.length === 0 && (
                      <code className="text-[10px] text-[var(--color-muted)]">no label yet</code>
                    )}
                  </div>
                  <div className="truncate text-xs">{slot.filename ?? slot.kind}</div>
                </div>

                <div className="flex shrink-0 gap-1 text-xs">
                  <button type="button" onClick={() => move(slot.id, -1)} disabled={i === 0} className="px-1 disabled:opacity-30">
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(slot.id, 1)}
                    disabled={i === slots.length - 1}
                    className="px-1 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => remove(slot.id)} className="px-1 text-[var(--color-danger)]">
                    ×
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                {ROLES_FOR[slot.kind].map((role) => {
                  const on = slot.roles.includes(role);
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() =>
                        update(slot.id, {
                          roles: on ? slot.roles.filter((r) => r !== role) : [...slot.roles, role],
                        })
                      }
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        on
                          ? 'bg-[var(--color-accent)] text-black'
                          : 'border border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
                      }`}
                    >
                      {role}
                    </button>
                  );
                })}
              </div>

              <textarea
                value={slot.description}
                onChange={(e) => update(slot.id, { description: e.target.value })}
                placeholder={
                  slot.kind === 'image'
                    ? 'What this contributes. Optional -- the planner can see the image.'
                    : 'Describe this clip, or click Analyze with Gemini (agentic) below.'
                }
                rows={2}
                className="mt-2 w-full resize-y rounded border border-[var(--color-edge)] bg-black/30 p-1.5 text-xs"
              />

              {slot.kind === 'video' && canAnalyzeVideo && (
                <div className="mt-2 flex flex-col gap-1 border-t border-[var(--color-edge)]/40 pt-1.5 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-muted)]">Gemini Agentic Video:</span>
                    {analyzingStatus[slot.id] ? (
                      <span className="animate-pulse font-medium text-[var(--color-accent)]">
                        {analyzingStatus[slot.id]}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          const file = fileMapRef.current.get(slot.id);
                          if (file) {
                            void runAnalysis(slot.id, file);
                          } else {
                            pendingSlotIdRef.current = slot.id;
                            filePickerRef.current?.click();
                          }
                        }}
                        className="rounded border border-[var(--color-edge)] bg-[var(--color-edge)]/20 px-2 py-0.5 text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                        title="Uploads clip to Files API and runs dynamic agentic video understanding"
                      >
                        Analyze with Gemini (agentic)
                      </button>
                    )}
                  </div>
                  {analyzeError[slot.id] && (
                    <div className="flex items-center justify-between text-[9px] text-[var(--color-danger)]">
                      <span>{analyzeError[slot.id]}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAnalyzeError((prev: Record<string, string>) => {
                            const next = { ...prev };
                            delete next[slot.id];
                            return next;
                          })
                        }
                        className="ml-1 underline"
                      >
                        dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Hidden input to pick video file if needed for re-analysis */}
      <input
        ref={filePickerRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && pendingSlotIdRef.current) {
            fileMapRef.current.set(pendingSlotIdRef.current, file);
            void runAnalysis(pendingSlotIdRef.current, file);
          }
          if (e.target) e.target.value = '';
        }}
      />
    </div>
  );
}
