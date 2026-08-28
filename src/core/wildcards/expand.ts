/**
 * Rolling an idea.
 *
 * `{setting}` in the idea text becomes a value drawn from that category. The
 * result is a new idea string and a record of what was drawn, and that is the
 * whole of it -- expansion happens on the idea, before anything is planned.
 * Nothing downstream of `CompileInput` ever sees a placeholder, because the
 * prompt text is a pure function of the document and a document assembled from
 * unexpanded text would render a `{setting}` into the H3 prompt.
 *
 * Forms, following the original engine's syntax:
 *
 *   {setting}           one value
 *   {setting:random}    the same thing, said out loud
 *   {setting:3random}   three distinct values, comma-joined
 *   {setting:all}       every value in the category, comma-joined
 *
 * A name no category matches is left in the text exactly as written and
 * reported, rather than deleted or replaced with a blank. An idea is the user's
 * own sentence; silently editing a word out of it is worse than leaving a
 * placeholder they can see.
 */

import { getCategory } from './library';

/** `{setting:3random}` picked apart. */
export interface Placeholder {
  /** The whole `{...}` as written, for replacement. */
  raw: string;
  category: string;
  /** How many values to draw. `all` becomes the category size at roll time. */
  count: number | 'all';
  /** Index of `raw` in the source text. */
  at: number;
}

export interface RollResult {
  /** The idea with every resolvable placeholder replaced. */
  text: string;
  /** What was drawn, per category, in the order the placeholders appeared. */
  picks: { category: string; values: string[] }[];
  /** Names no category matched. Left untouched in the text. */
  unknown: string[];
}

/**
 * A category name is a bare identifier, and the modifier is either `all`, or a
 * count followed by `random`, or `random` on its own. Anything else is not a
 * placeholder at all -- `{}` and prose in braces stay prose.
 */
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)(?::(all|random|\d+random))?\}/gi;

export function placeholdersIn(text: string): Placeholder[] {
  const found: Placeholder[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const modifier = (m[2] ?? 'random').toLowerCase();
    const count: number | 'all' =
      modifier === 'all' ? 'all' : modifier === 'random' ? 1 : Number.parseInt(modifier, 10);
    found.push({ raw: m[0], category: m[1].toLowerCase(), count, at: m.index });
  }
  return found;
}

/** Whether the text has anything to roll. */
export function hasPlaceholders(text: string): boolean {
  return placeholdersIn(text).length > 0;
}

/**
 * Draw `count` distinct values, in the category's own order once more than the
 * category holds is asked for.
 *
 * Distinctness matters more than the count: `{prop:3random}` on a category of
 * two is asking for something impossible, and two values read better than one
 * value written twice.
 *
 * Exported because the matrix draws too. A placeholder asking for several
 * values is not an axis, and it has to be resolved the same way there as here
 * or the same text would mean two different things depending on which button
 * was pressed.
 */
export function draw(values: readonly string[], count: number, random: () => number): string[] {
  const wanted = Math.min(Math.max(count, 1), values.length);
  // Taking all of them is not a draw. `{era:all}` says every value, and every
  // value in a random order is a different sentence each time for no reason.
  if (wanted === values.length) return [...values];

  const pool = [...values];
  const out: string[] = [];
  while (out.length < wanted && pool.length > 0) {
    const i = Math.floor(random() * pool.length) % pool.length;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/**
 * Replace every resolvable placeholder in the text.
 *
 * The random function is a parameter so a test can pin it and so a seed can
 * make a roll repeatable, the same as `randomWild` and `randomGlitch`.
 */
export function roll(text: string, random: () => number = Math.random): RollResult {
  const found = placeholdersIn(text);
  const picks: RollResult['picks'] = [];
  const unknown: string[] = [];

  // Right to left, so an earlier replacement cannot move a later index.
  let out = text;
  const resolved: { at: number; raw: string; replacement: string }[] = [];

  // One draw per request, reused at every occurrence. `{setting} then back to
  // {setting}` is one place said twice, not two places -- and the matrix reads
  // it that way, so drawing independently here made the same sentence mean
  // different things depending on which button was pressed.
  //
  // Keyed by category and count rather than by the raw text: this file's own
  // header calls `{setting:random}` the same thing as `{setting}` said out
  // loud, so keying on the written form had those two drawing separately.
  // `{prop}` and `{prop:2random}` stay separate, because they ask for
  // different amounts.
  const drawnFor = new Map<string, string>();
  const requestKey = (p: Placeholder) => `${p.category}\u0000${p.count}`;

  for (const p of found) {
    const category = getCategory(p.category);
    if (!category) {
      if (!unknown.includes(p.category)) unknown.push(p.category);
      continue;
    }

    const already = drawnFor.get(requestKey(p));
    if (already != null) {
      resolved.push({ at: p.at, raw: p.raw, replacement: already });
      continue;
    }

    const count = p.count === 'all' ? category.values.length : p.count;
    const values = draw(category.values, count, random);
    drawnFor.set(requestKey(p), values.join(', '));
    picks.push({ category: p.category, values });
    resolved.push({ at: p.at, raw: p.raw, replacement: values.join(', ') });
  }

  for (const r of [...resolved].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, r.at) + r.replacement + out.slice(r.at + r.raw.length);
  }

  return { text: out, picks, unknown };
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/**
 * mulberry32: a small, fast, well-distributed PRNG.
 *
 * The point of a seed here is not cryptography, it is being able to say "that
 * one, again" about a roll you liked, and to hold every variable but one fixed
 * while comparing two prompts.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed to show the user. Small enough to retype, large enough to vary. */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 1_000_000);
}

/** Roll with a seed, so the same seed and text always give the same idea. */
export function rollSeeded(text: string, seed: number): RollResult {
  return roll(text, seededRandom(seed));
}

/**
 * The record of a roll, or nothing when there was no roll to record.
 *
 * A template whose every name is unknown still "rolls" -- `hasPlaceholders` is
 * true and `roll` returns text -- but nothing was drawn, so stamping a seed on
 * the document would record a roll that substituted nothing and label the
 * version with a seed that reproduces the template unchanged.
 *
 * Lives here rather than in the hook that needs it, because a decision made
 * inline in a component is a decision no test can reach.
 */
export function rollRecord(
  template: string,
  seed: number | null,
): { template: string; seed: number } | undefined {
  if (seed == null) return undefined;
  if (rollSeeded(template, seed).picks.length === 0) return undefined;
  return { template, seed };
}
