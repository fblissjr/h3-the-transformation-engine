/**
 * The shape a patchable leaf accepts, read off the document schema itself.
 *
 * `PATCHABLE_LEAVES` says which paths may be written. It says nothing about
 * what may be written into them, and for a while nothing did: the editor's cut
 * time went in as whatever `Number()` returned, and a model patch operation is
 * typed `value: string`, so an assisted edit of the same field wrote the string
 * `"5200"`. Both produce a document that saves, serializes, validates clean, and
 * then fails `H3DocumentSchema` on the next load -- a notice on every open, for
 * a value the app itself wrote.
 *
 * The shapes are walked out of `H3DocumentSchema` rather than listed here,
 * because a second table of field types is a table that drifts from the first.
 * `shots[].cutAtMs` is an int at or above zero because the schema says so in one
 * place, and a leaf whose schema this cannot resolve is refused rather than
 * written blind.
 */

import { z } from 'zod';
import { H3DocumentSchema } from './schema';

/** Strip optional/nullable/default to the type underneath, for walking. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  while (
    current.def.type === 'optional' ||
    current.def.type === 'nullable' ||
    current.def.type === 'default'
  ) {
    current = (current as unknown as { unwrap: () => z.ZodType }).unwrap();
  }
  return current;
}

/**
 * The schema for a path pattern like `shots[].camera.type`, or null if the
 * document schema has no such field.
 *
 * The wrappers are stripped while walking and kept on the leaf that comes back:
 * `cutAtMs` is nullable and a null write is legal, `camera.amplitude` is
 * optional and the editor's "medium" option commits `undefined`.
 */
export function leafSchema(pattern: string): z.ZodType | null {
  let current: z.ZodType = H3DocumentSchema;

  for (const segment of pattern.split('.')) {
    const isArray = segment.endsWith('[]');
    const key = isArray ? segment.slice(0, -2) : segment;

    const object = unwrap(current);
    if (object.def.type !== 'object') return null;
    const shape = (object as unknown as { shape: Record<string, z.ZodType> }).shape;
    const next = shape[key];
    if (!next) return null;
    current = next;

    if (isArray) {
      const array = unwrap(current);
      if (array.def.type !== 'array') return null;
      current = (array as unknown as { element: z.ZodType }).element;
    }
  }

  return current;
}

/**
 * A patch value in the shape its leaf expects, as far as that is unambiguous.
 *
 * Two conversions, both of them for the model's benefit rather than the
 * editor's: a patch operation carries `value: string`, so a numeric field
 * arrives as text, and a list field arrives as one line-or-comma separated
 * string. Neither invents a value -- an empty string stays an empty string and
 * is refused by the leaf below, which is where `Number('') === 0` would
 * otherwise become a cut at the start of the video.
 */
export function coerceToLeaf(leaf: z.ZodType, before: unknown, value: unknown): unknown {
  if (Array.isArray(before) && typeof value === 'string') return splitList(value);
  if (unwrap(leaf).def.type === 'number' && typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? value : Number(trimmed);
  }
  return value;
}

/** Newline- or comma-separated string into a trimmed list, dropping blanks. */
function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
