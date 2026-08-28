/**
 * Creative mode panel.
 *
 * Controls what a creative record contributes to the planner prompt: a style
 * direction and, independently, a set of glitch marks. Off = no style. Directed
 * = the user picks packs. Wild = a random high-leverage draw. The marks have
 * their own controls and are not cleared by any of the three.
 *
 * Every control here is driven by the record passed in and writes back through
 * `onChange`. The panel holds no state of its own on purpose: when it did, a
 * reload restored the badge but not the dropdowns, and the first change to any
 * dropdown read the empty local copy and silently cleared the style.
 */

import type {
  AudioPackId,
  WritableCreativeMode,
  CreativeModeRecord,
  CreativeSelection,
  FinishPackId,
  GlitchRegister,
  GlitchSelection,
  GlitchSurfaceId,
  GlitchTokenDef,
  GlitchTokenId,
  MotionPackId,
  PackDef,
  VisualId,
} from '../../core/creative';
import {
  AUDIO_PACKS,
  FINISH_PACKS,
  GLITCH_MAX_TOKENS,
  GLITCH_REGISTERS,
  GLITCH_SURFACES,
  GLITCH_TOKENS,
  MOTION_PACKS,
  STRENGTH_LEVELS,
  STYLE_ANCHORS,
  VISUAL_PACKS,
  describeRecord,
  randomGlitch,
  randomWild,
  withGlitch,
} from '../../core/creative';

const MODES: (WritableCreativeMode | null)[] = [null, 'directed', 'wild'];

const MODE_LABELS: Record<string, string> = {
  off: 'Off',
  directed: 'Directed',
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
  const glitch = value?.glitch;
  const label = describeRecord(value);

  const pickMode = (next: WritableCreativeMode | null) => {
    if (next === mode) return;
    // Off clears the style. It does not clear the marks: they are a separate
    // contribution with their own controls, which stay on screen when the mode
    // buttons read Off, and clearing something whose controls are still showing
    // its selection is the panel disagreeing with itself.
    if (next === null) {
      return onChange(glitch ? withGlitch({ mode: 'directed', selection: EMPTY }, glitch) : null);
    }
    if (next === 'wild') return onChange(withGlitch(randomWild(), glitch));
    onChange(withGlitch({ mode: next, selection: EMPTY }, glitch));
  };

  /**
   * Marks are independent of the style, so choosing one while the panel is off
   * has to produce a record rather than nothing. `directed` with an empty
   * selection is what a record with marks and no packs looks like, and it is a
   * complete direction on its own.
   */
  const setGlitch = (next: GlitchSelection | undefined) => {
    onChange(withGlitch({ mode: mode ?? 'directed', selection }, next));
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
          onChange={(next) => onChange(withGlitch({ mode: 'directed', selection: next }, glitch))}
        />
      )}

      {mode === 'wild' && (
        <button
          type="button"
          onClick={() => onChange(withGlitch(randomWild(), glitch))}
          className="w-full rounded border border-[var(--color-edge)] px-2 py-1.5 text-xs hover:bg-white/5"
        >
          Shuffle
        </button>
      )}

      <GlitchControls glitch={glitch} onChange={setGlitch} />

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
// Glitch marks
// ---------------------------------------------------------------------------

const chipClass = (on: boolean) =>
  `rounded border px-1.5 py-0.5 text-[10px] ${
    on
      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
      : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
  }`;

/**
 * The table widened back to its own interface.
 *
 * `as const satisfies` narrows each entry to exactly the keys it has, so the
 * entries without a `skew` do not carry the optional field at all and the union
 * cannot be read uniformly.
 */
const TOKEN_DEFS: readonly GlitchTokenDef[] = GLITCH_TOKENS;

const REGISTER_LABELS: Record<GlitchRegister, string> = {
  motif: 'Marks only',
  ood: 'Marks + OOD prose',
};

/**
 * The marks are shown as a flat list of chips rather than a dropdown because
 * the identity of the string is the whole point: a code standing in for one
 * would hide the only thing the user is actually choosing.
 *
 * Selecting past the cap is refused rather than silently trimmed. The
 * derivation caps too, but a picker that accepted a fourth and then showed
 * three would be reporting a selection nobody made.
 */
function GlitchControls({
  glitch,
  onChange,
}: {
  glitch: GlitchSelection | undefined;
  onChange: (next: GlitchSelection | undefined) => void;
}) {
  const tokens = glitch?.tokens ?? [];
  const surfaces = glitch?.surfaces ?? [];
  const register: GlitchRegister = glitch?.register ?? 'motif';
  const atCap = tokens.length >= GLITCH_MAX_TOKENS;

  /** Dropping the last mark clears the record, so "none selected" is one state. */
  const write = (next: Partial<GlitchSelection>) => {
    const merged: GlitchSelection = { tokens, surfaces, register, ...next };
    if (merged.tokens.length === 0) return onChange(undefined);
    onChange(merged);
  };

  const toggleToken = (id: GlitchTokenId) => {
    if (tokens.includes(id)) return write({ tokens: tokens.filter((t) => t !== id) });
    if (atCap) return;
    write({ tokens: [...tokens, id] });
  };

  const toggleSurface = (id: GlitchSurfaceId) => {
    write({
      surfaces: surfaces.includes(id) ? surfaces.filter((s) => s !== id) : [...surfaces, id],
    });
  };

  return (
    <div className="space-y-1.5 border-t border-[var(--color-edge)] pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Glitch marks
        </span>
        <button
          type="button"
          onClick={() => onChange(randomGlitch())}
          className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)] hover:bg-white/5"
        >
          Draw
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {TOKEN_DEFS.map((t) => {
          const on = tokens.includes(t.id as GlitchTokenId);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              disabled={!on && atCap}
              title={t.skew ? `${t.note} ${t.skew}` : t.note}
              onClick={() => toggleToken(t.id as GlitchTokenId)}
              className={`${chipClass(on)} ${!on && atCap ? 'opacity-40' : ''} ${
                t.skew && !on ? 'italic' : ''
              }`}
            >
              {t.id}
              {t.skew ? ' *' : ''}
            </button>
          );
        })}
      </div>

      {tokens.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1">
            {GLITCH_SURFACES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={surfaces.includes(s.id)}
                title={s.directive}
                onClick={() => toggleSurface(s.id)}
                className={chipClass(surfaces.includes(s.id))}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {GLITCH_REGISTERS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={register === r}
                onClick={() => write({ register: r })}
                className={`flex-1 ${chipClass(register === r)}`}
              >
                {REGISTER_LABELS[r]}
              </button>
            ))}
          </div>

          <p className="text-[10px] text-[var(--color-muted)]">
            {atCap ? `${GLITCH_MAX_TOKENS} is the ceiling. ` : ''}
            Each mark appears once, as visible text in the scene. No surface selected means the
            planner varies them. A starred mark carries a documented pull of its own.
          </p>
        </>
      )}
    </div>
  );
}
