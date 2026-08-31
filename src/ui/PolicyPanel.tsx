/**
 * The settings cascade, shown with the scope each value came from.
 *
 * The whole reason `explainPolicy` returns a scope rather than a value: "why is
 * this 1?" is the question anyone asks of a layered configuration, and a panel
 * that shows only the resolved number makes people read four layers by hand.
 * Every row says where its value came from, so inherited and set-here are never
 * the same thing on screen.
 *
 * Most rows are read-only, and that is the honest state rather than an
 * unfinished one. `POLICY_FIELDS[key].settable` is false for three of the four
 * attributes because nothing in `src/` reads them -- offering an input for a
 * value no code consumes is the mistake `describeConcurrency` exists to
 * confess, and repeating it three times over would make this panel a menu of
 * controls that do nothing.
 */

import { useState } from 'react';
import {
  POLICY_FIELDS,
  POLICY_KEYS,
  type Policy,
  type PolicyField,
  type Scope,
  type Sourced,
} from '../core/policy';
import { describeConcurrency } from '../provider/registry';

interface Props {
  /** The resolved policy, for renderers that need the whole of it. */
  policy: Policy;
  /** Each resolved attribute with the scope that supplied it. */
  explained: Partial<Record<keyof Policy, Sourced<unknown>>>;
  /** What the active machine states for itself. Empty when it states nothing. */
  instancePolicy: Policy;
  /** The machine being configured, or null when this provider has no instances. */
  instanceId: string | null;
  onChange: (next: Policy) => void;
}

/** Where a value came from, in words rather than a scope key. */
const SCOPE_LABEL: Record<Scope, string> = {
  instance: 'this machine',
  provider: 'this provider',
  providerType: 'provider type',
  global: 'built-in',
};

/**
 * Milliseconds are stored; seconds are shown.
 *
 * A retry budget reads as 300000 to nobody, and the conversion happens at this
 * one boundary rather than in the stored value, so nothing downstream has to
 * know which unit it holds.
 */
function toSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

function displayNumber(field: PolicyField, value: unknown): string {
  if (typeof value !== 'number') return '';
  return String(field.kind === 'duration-ms' ? toSeconds(value) : value);
}

function formatValue(key: keyof Policy, value: unknown, policy: Policy): string {
  // Concurrency has a renderer already, and it says more than the number does:
  // the value is resolved and displayed but gates nothing, because the app's
  // single-flight guard is stricter than any policy value.
  if (key === 'maxConcurrentRequests') return describeConcurrency(policy);
  if (POLICY_FIELDS[key].kind === 'duration-ms' && typeof value === 'number') {
    return `${toSeconds(value)}s`;
  }
  return String(value);
}

/**
 * One attribute, with a draft while it is being typed into.
 *
 * The draft is the whole reason this is a component rather than a few lines in
 * the map below, and it is not a nicety. A controlled input whose value is
 * recomputed from the stored number on every keystroke fights the person
 * typing: with seconds shown and milliseconds stored, entering "60" over "300"
 * stored 3000000 -- each keystroke was committed, converted up, and read back
 * as a longer string for the next one to append to. Nothing in the suite could
 * have seen it, because the round trip only exists on screen. It was found by
 * typing into the box, which is the standing reason to open the app.
 *
 * So a row being edited shows what was typed, and re-reads the resolved value
 * on blur -- which is also what makes an override the parser refuses visibly
 * snap back to what is actually stored.
 */
function PolicyRow({
  attribute,
  field,
  found,
  policy,
  instancePolicy,
  editable,
  onChange,
}: {
  attribute: keyof Policy;
  field: PolicyField;
  found: Sourced<unknown> | undefined;
  policy: Policy;
  instancePolicy: Policy;
  editable: boolean;
  onChange: (next: Policy) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const overridden = instancePolicy[attribute] !== undefined;

  const clear = () => {
    const next = { ...instancePolicy };
    delete next[attribute];
    onChange(next);
  };

  const commit = (raw: string) => {
    setDraft(raw);
    // An emptied box clears the override rather than storing zero. Clearing has
    // to be reachable, or the only way back to the default is to guess what it
    // was.
    if (raw.trim() === '') {
      clear();
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange({
      ...instancePolicy,
      [attribute]: field.kind === 'duration-ms' ? parsed * 1000 : parsed,
    });
  };

  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[130px] shrink-0">{field.label}</span>

      {editable ? (
        <input
          type="number"
          min={field.kind === 'duration-ms' ? 0 : field.min}
          value={draft ?? displayNumber(field, found?.value)}
          onChange={(event) => commit(event.target.value)}
          onBlur={() => setDraft(null)}
          className="w-[70px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
        />
      ) : (
        <span className="text-[var(--color-fg)]">
          {found ? formatValue(attribute, found.value, policy) : 'not set'}
        </span>
      )}

      {field.kind === 'duration-ms' && editable && <span>seconds</span>}

      {/*
        The point of the whole panel. `found.scope` is 'instance' only when this
        machine stated the value itself, so "built-in" and "this machine" cannot
        look alike -- which is what a reset button needs in order to mean
        anything.
      */}
      <span className="ml-auto shrink-0">
        {found ? SCOPE_LABEL[found.scope] : '--'}
        {overridden && editable && (
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              setDraft(null);
              clear();
            }}
          >
            reset
          </button>
        )}
      </span>
    </div>
  );
}

export function PolicyPanel({ policy, explained, instancePolicy, instanceId, onChange }: Props) {
  return (
    <details className="text-[10px] text-[var(--color-muted)]">
      <summary className="cursor-pointer select-none underline">machine settings</summary>
      {/*
        Floated rather than inline: the header is a flex row, and a four-row
        table opened inside it pushed the provider controls off the edge of the
        window.
      */}
      <div className="absolute right-2 z-10 mt-1 flex w-[420px] flex-col gap-1 rounded border border-[var(--color-edge)] bg-[var(--color-panel)] p-2">
        {POLICY_KEYS.map((key) => (
          <PolicyRow
            key={key}
            attribute={key}
            // Widened to the declared interface rather than the literal table's
            // union: a row renders from what a field IS, not from which four
            // fields happen to exist today.
            field={POLICY_FIELDS[key] as PolicyField}
            found={explained[key]}
            policy={policy}
            instancePolicy={instancePolicy}
            // Editable only where a stored value would reach something, and only
            // when there is a machine to store it against -- instances are
            // heylook's, so on Gemini there is nowhere for an override to live.
            editable={POLICY_FIELDS[key].settable && instanceId != null}
            onChange={onChange}
          />
        ))}

        <p className="mt-1 leading-snug">
          {instanceId == null
            ? 'Settings are stored per machine, and this provider has none -- its values come ' +
              'from the built-in layers.'
            : `Stored for ${instanceId}. Only the retry budget changes what the app does; the ` +
              'others are resolved and shown so the cascade can be read, and are consumed by ' +
              'nothing today.'}
        </p>
      </div>
    </details>
  );
}
