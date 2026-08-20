/**
 * Creative mode panel.
 *
 * Controls which style directive is injected into the planner prompt.
 * Off = no creative directive. Directed = user picks packs. Exploratory =
 * named presets. Wild = random high-leverage combination.
 */

import type {
  CreativeMode,
  VisualPackId,
  MotionPackId,
  FinishPackId,
  AudioPackId,
  StyleInjection,
  StrengthLevel,
} from '../../core/creative/types';
import {
  VISUAL_PACKS,
  MOTION_PACKS,
  FINISH_PACKS,
  AUDIO_PACKS,
  resolve,
  randomWild,
  PRESETS,
} from '../../core/creative';

const STRENGTH_LEVELS: StrengthLevel[] = ['subtle', 'full', 'stress-test'];

interface CreativePanelProps {
  mode: CreativeMode | null;
  onModeChange: (mode: CreativeMode | null) => void;
  style: StyleInjection | null;
  onStyleChange: (style: StyleInjection | null) => void;
}

export function CreativePanel({ mode, onModeChange, style, onStyleChange }: CreativePanelProps) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Creative Mode
      </label>

      {/* Mode toggle */}
      <div className="flex gap-1" role="group" aria-label="Creative mode">
        {([null, 'directed', 'exploratory', 'wild'] as const).map((m) => (
          <button
            key={m ?? 'off'}
            type="button"
            onClick={() => {
              if (mode === m) return;
              onModeChange(m);
              if (m === 'wild') onStyleChange(randomWild());
              else onStyleChange(null);
            }}
            className={`flex-1 rounded border px-2 py-1 text-[10px] ${
              mode === m
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
            }`}
          >
            {m === null ? 'Off' : m === 'directed' ? 'Directed' : m === 'exploratory' ? 'Presets' : 'Wild'}
          </button>
        ))}
      </div>

      {/* Directed mode: pack selectors */}
      {mode === 'directed' && <DirectedControls onStyleChange={onStyleChange} />}

      {/* Exploratory mode: preset cards */}
      {mode === 'exploratory' && <PresetCards onStyleChange={onStyleChange} activePresetId={findActivePreset(style)} />}

      {/* Wild mode: shuffle button */}
      {mode === 'wild' && (
        <button
          type="button"
          onClick={() => onStyleChange(randomWild())}
          className="w-full rounded border border-[var(--color-edge)] px-2 py-1.5 text-xs hover:bg-white/5"
        >
          Shuffle
        </button>
      )}

      {/* Active style badge */}
      {style && (
        <div className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-2 py-1.5">
          <div className="text-[10px] font-semibold text-[var(--color-accent)]">
            {style.description}
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
            {style.selection.strength} strength
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directed mode controls
// ---------------------------------------------------------------------------

import { useState } from 'react';

function DirectedControls({ onStyleChange }: { onStyleChange: (s: StyleInjection | null) => void }) {
  const [visual, setVisual] = useState<VisualPackId | ''>('');
  const [motion, setMotion] = useState<MotionPackId | ''>('');
  const [finish, setFinish] = useState<FinishPackId | ''>('');
  const [audio, setAudio] = useState<AudioPackId | ''>('');
  const [strength, setStrength] = useState<StrengthLevel>('full');

  const apply = (
    v = visual,
    m = motion,
    f = finish,
    a = audio,
    s = strength,
  ) => {
    if (!v) {
      onStyleChange(null);
      return;
    }
    onStyleChange(
      resolve(
        {
          visual: v as VisualPackId,
          ...(m ? { motion: m as MotionPackId } : {}),
          ...(f ? { finish: f as FinishPackId } : {}),
          ...(a ? { audio: a as AudioPackId } : {}),
          strength: s,
        },
        'directed',
      ),
    );
  };

  const selectClass = 'w-full rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs';

  return (
    <div className="space-y-1.5">
      <select
        aria-label="Visual medium"
        value={visual as string}
        onChange={(ev) => {
          const v = ev.target.value as VisualPackId | '';
          setVisual(v);
          apply(v);
        }}
        className={selectClass}
      >
        <option value="">Visual medium...</option>
        {VISUAL_PACKS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} {p.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Motion behavior"
        value={motion}
        onChange={(ev) => {
          const m = ev.target.value as MotionPackId | '';
          setMotion(m);
          apply(undefined, m);
        }}
        className={selectClass}
      >
        <option value="">Motion behavior...</option>
        {MOTION_PACKS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} {p.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Finish"
        value={finish}
        onChange={(ev) => {
          const f = ev.target.value as FinishPackId | '';
          setFinish(f);
          apply(undefined, undefined, f);
        }}
        className={selectClass}
      >
        <option value="">Finish...</option>
        {FINISH_PACKS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} {p.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Audio treatment"
        value={audio}
        onChange={(ev) => {
          const a = ev.target.value as AudioPackId | '';
          setAudio(a);
          apply(undefined, undefined, undefined, a);
        }}
        className={selectClass}
      >
        <option value="">Audio treatment...</option>
        {AUDIO_PACKS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id} {p.name}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--color-muted)]">Strength</span>
        {STRENGTH_LEVELS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStrength(s);
              apply(undefined, undefined, undefined, undefined, s);
            }}
            className={`rounded border px-2 py-0.5 text-[10px] ${
              strength === s
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset cards
// ---------------------------------------------------------------------------

function PresetCards({
  onStyleChange,
  activePresetId,
}: {
  onStyleChange: (s: StyleInjection) => void;
  activePresetId: string | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onStyleChange(resolve(p.selection, 'exploratory'))}
          className={`rounded border p-1.5 text-left ${
            activePresetId === p.id
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
              : 'border-[var(--color-edge)] hover:bg-white/5'
          }`}
        >
          <div className="text-[10px] font-semibold">{p.name}</div>
          <div className="text-[10px] text-[var(--color-muted)]">{p.description}</div>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findActivePreset(style: StyleInjection | null): string | null {
  if (!style || style.mode !== 'exploratory') return null;
  const v = style.selection.visual;
  const m = style.selection.motion;
  const f = style.selection.finish;
  const a = style.selection.audio;
  for (const p of PRESETS) {
    if (
      p.selection.visual === v &&
      p.selection.motion === m &&
      p.selection.finish === f &&
      p.selection.audio === a
    ) {
      return p.id;
    }
  }
  return null;
}
