/**
 * The experiment matrix.
 *
 * Rolling answers "give me something else". This answers the other question:
 * hold everything fixed but one axis, and see what changes. It is the cartesian
 * product of the values you nominate for each placeholder, so a template with
 * three settings and two times produces six ideas that differ in exactly the
 * ways you chose and in no other way.
 *
 * That control is the whole point. Whether the planner's prose conditions H3
 * well is the open question in this repo, and the only honest way to ask it is
 * two prompts that differ in one thing.
 *
 * This produces ideas, not documents. Compiling them is a call each, so the
 * decision to spend that belongs to the person pressing the button.
 */

import { getCategory } from './library';
import { placeholdersIn } from './expand';

export interface MatrixCell {
  /** The value chosen for each axis, keyed by category. */
  values: Record<string, string>;
  /** The template with those values substituted. */
  text: string;
}

export interface Matrix {
  cells: MatrixCell[];
  /** The axes actually used, in template order. */
  axes: { category: string; values: string[] }[];
  /** How many cells the configuration describes, before any cap. */
  total: number;
  /** True when `cells` holds fewer than `total`. */
  truncated: boolean;
}

/**
 * Above this the matrix stops being something a person reads and starts being
 * a bill. Four axes of three is already 81.
 */
export const MATRIX_CELL_LIMIT = 64;

/**
 * Every combination of one value per axis, in odometer order.
 *
 * No axes means no experiment, not one empty cell. The identity of a cartesian
 * product is a single empty row, which is correct arithmetic and the wrong
 * answer here -- it would offer the untouched template back as though varying
 * nothing were a result.
 */
function product(axes: { category: string; values: string[] }[], limit: number): Record<string, string>[] {
  if (axes.length === 0) return [];
  let rows: Record<string, string>[] = [{}];
  for (const axis of axes) {
    const next: Record<string, string>[] = [];
    for (const row of rows) {
      for (const value of axis.values) {
        if (next.length >= limit) break;
        next.push({ ...row, [axis.category]: value });
      }
    }
    rows = next;
  }
  return rows;
}

/**
 * Build the matrix for a template.
 *
 * `config` names the values to vary per category. A placeholder the config does
 * not mention takes the whole category, which is what makes the common case --
 * "vary the setting, leave everything else" -- a matter of naming one axis.
 * A category nothing recognises is skipped and its placeholder is left standing
 * in the text, the same tolerance `roll` has.
 */
export function experimentMatrix(
  template: string,
  config: Record<string, string[]> = {},
): Matrix {
  const seen = new Set<string>();
  const axes: { category: string; values: string[] }[] = [];

  for (const placeholder of placeholdersIn(template)) {
    if (seen.has(placeholder.category)) continue;
    const category = getCategory(placeholder.category);
    if (!category) continue;
    seen.add(placeholder.category);

    const chosen = config[placeholder.category];
    const values = chosen && chosen.length > 0
      ? chosen.filter((v) => category.values.includes(v as never))
      : [...category.values];
    if (values.length === 0) continue;

    axes.push({ category: placeholder.category, values });
  }

  const total = axes.reduce((n, axis) => n * axis.values.length, axes.length > 0 ? 1 : 0);
  const rows = product(axes, MATRIX_CELL_LIMIT);

  const cells = rows.map((values) => ({
    values,
    text: substitute(template, values),
  }));

  return { cells, axes, total, truncated: total > cells.length };
}

/** Replace each placeholder with the value chosen for its category. */
function substitute(template: string, values: Record<string, string>): string {
  const found = placeholdersIn(template);
  let out = template;
  for (const p of [...found].sort((a, b) => b.at - a.at)) {
    const value = values[p.category];
    if (value == null) continue;
    out = out.slice(0, p.at) + value + out.slice(p.at + p.raw.length);
  }
  return out;
}
