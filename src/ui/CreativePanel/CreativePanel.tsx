/**
 * Creative mode panel.
 *
 * Controls which style directive is injected into the planner prompt. Off = no
 * creative directive. Directed = the user picks packs. Presets = named
 * combinations. Wild = a random high-leverage draw.
 *
 * Every control here is driven by the record passed in and writes back through
 * `onChange`. The panel holds no state of its own on purpose: when it did, a
 * reload restored the badge but not the dropdowns, and the first change to any
 * dropdown read the empty local copy and silently cleared the style.
 */

import type {
  AudioPackId,
  CreativeMode,
  CreativeModeRecord,
  CreativeSelection,
  FinishPackId,
  MotionPackId,
  PackDef,
  VisualId,
} from '../../core/creative';
import {
  AUDIO_PACKS,
  FINISH_PACKS,
  MOTION_PACKS,
  PRESETS,
  STRENGTH_LEVELS,
  STYLE_ANCHORS,
  VISUAL_PACKS,
  describeSelection,
  randomWild,
  sameSelection,
} from '../../core/creative';

const MODES: (CreativeMode | null)[] = [null, 'directed', 'exploratory', 'wild'];

const MODE_LABELS: Record<string, string> = {
  off: 'Off',
  directed: 'Directed',
  exploratory: 'Presets',
  wild: 'Wild',
};

/** An empty selection is legal: it is the state of a mode picked but not filled in. */
const EMPTY: CreativeSelection = { strength: 'full' };

interface CreativePanelProps {
  value: CreativeModeRecord | null;
  onChange: (value: CreativeModeRecord | null) => void;
  /**
   * True when a document is open and was written under a different style.
   *
   * The picker and the open document carry two different facts: what the next
   * generation will use, and what the current prose was actually written in.
   * An assisted edit preserves the latter, so when they disagree the badge has
   * to say which one it is describing.
   */
  appliesToNextGeneration: boolean;
}

export function CreativePanel({ value, onChange, appliesToNextGeneration }: CreativePanelProps) {
  const mode = value?.mode ?? null;
  const selection = value?.selection ?? EMPTY;
  const label = describeSelection(selection);

  const pickMode = (next: CreativeMode | null) => {
    if (next === mode) return;
    if (next === null) return onChange(null);
    if (next === 'wild') return onChange(randomWild());
    onChange({ mode: next, selection: EMPTY });
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        Creative Mode
      </label>

      <div className="flex gap-1" role="group" aria-label="Creative mode">
        {MODES.map((m) => (
          <button
            key={m ?? 'off'}
            type="button"
            aria-pressed={mode === m}
            onClick={() => pickMode(m)}
            className={`flex-1 rounded border px-2 py-1 text-[10px] ${
              mode === m
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
            }`}
          >
            {MODE_LABELS[m ?? 'off']}
          </button>
        ))}
      </div>

      {mode === 'directed' && (
        <DirectedControls
          selection={selection}
          onChange={(next) => onChange({ mode: 'directed', selection: next })}
        />
      )}

      {mode === 'exploratory' && (
        <PresetCards
          selection={selection}
          onChange={(next) => onChange({ mode: 'exploratory', selection: next })}
        />
      )}

      {mode === 'wild' && (
        <button
          type="button"
          onClick={() => onChange(randomWild())}
          className="w-full rounded border border-[var(--color-edge)] px-2 py-1.5 text-xs hover:bg-white/5"
        >
          Shuffle
        </button>
      )}

      {label !== '' && (
        <div className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 px-2 py-1.5">
          <div className="text-[10px] font-semibold text-[var(--color-accent)]">{label}</div>
          <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
            {selection.strength} strength
          </div>
          {appliesToNextGeneration && (
            <div className="mt-1 text-[10px] text-[var(--color-muted)]">
              Applies to the next generation. Edits keep the style the open prompt was written in.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Directed mode controls
// ---------------------------------------------------------------------------

const selectClass = 'w-full rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs';

/** Drop the key entirely when the placeholder option is chosen, rather than storing ''. */
function withField<K extends keyof CreativeSelection>(
  selection: CreativeSelection,
  key: K,
  raw: string,
): CreativeSelection {
  const next = { ...selection };
  if (raw === '') delete next[key];
  else next[key] = raw as CreativeSelection[K];
  return next;
}

function PackSelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string | undefined;
  options: readonly PackDef[] | { group: string; packs: readonly PackDef[] }[];
  onPick: (raw: string) => void;
}) {
  const groups = Array.isArray(options) && 'group' in (options[0] ?? {})
    ? (options as { group: string; packs: readonly PackDef[] }[])
    : [{ group: '', packs: options as readonly PackDef[] }];

  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(ev) => onPick(ev.target.value)}
      className={selectClass}
    >
      <option value="">{label}...</option>
      {groups.map(({ group, packs }) =>
        group === '' ? (
          packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} {p.name}
            </option>
          ))
        ) : (
          <optgroup key={group} label={group}>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} {p.name}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </select>
  );
}

function DirectedControls({
  selection,
  onChange,
}: {
  selection: CreativeSelection;
  onChange: (next: CreativeSelection) => void;
}) {
  return (
    <div className="space-y-1.5">
      <PackSelect
        label="Visual medium"
        value={selection.visual}
        options={[
          { group: 'Medium', packs: VISUAL_PACKS },
          { group: 'Reference anchors', packs: STYLE_ANCHORS },
        ]}
        onPick={(raw) => onChange(withField(selection, 'visual', raw as VisualId))}
      />
      <PackSelect
        label="Motion behavior"
        value={selection.motion}
        options={MOTION_PACKS}
        onPick={(raw) => onChange(withField(selection, 'motion', raw as MotionPackId))}
      />
      <PackSelect
        label="Finish"
        value={selection.finish}
        options={FINISH_PACKS}
        onPick={(raw) => onChange(withField(selection, 'finish', raw as FinishPackId))}
      />
      <PackSelect
        label="Audio treatment"
        value={selection.audio}
        options={AUDIO_PACKS}
        onPick={(raw) => onChange(withField(selection, 'audio', raw as AudioPackId))}
      />

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--color-muted)]">Strength</span>
        {STRENGTH_LEVELS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={selection.strength === s}
            onClick={() => onChange({ ...selection, strength: s })}
            className={`rounded border px-2 py-0.5 text-[10px] ${
              selection.strength === s
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
  selection,
  onChange,
}: {
  selection: CreativeSelection;
  onChange: (next: CreativeSelection) => void;
}) {
  const active = PRESETS.find((p) => sameSelection(p.selection, selection))?.id ?? null;

  return (
    <div className="grid grid-cols-2 gap-1">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={active === p.id}
          onClick={() => onChange({ ...p.selection })}
          className={`rounded border p-1.5 text-left ${
            active === p.id
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
