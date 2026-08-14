/**
 * Document -> H3 prompt text.
 *
 * Pure and total: same document plus same context always yields the same string
 * and the same source map. That property is what lets the editor re-render on
 * every keystroke and lets the golden fixtures assert byte equality.
 */

import type { H3Document, NormalizedContext } from '../ir/types';
import { contractFor } from '../ir/vocab';
import { serializeBase } from './base';
import { serializeRef2va } from './ref2va';
import type { SourceSpan } from './emitter';

export * from './emitter';
export * from './shared';

export interface SerializeResult {
  text: string;
  map: SourceSpan[];
  /** Convenience for the UI's character counter. */
  length: number;
}

export function serialize(doc: H3Document, ctx: NormalizedContext): SerializeResult {
  const { text, map } =
    contractFor(doc.mode) === 'ref2va' ? serializeRef2va(doc, ctx) : serializeBase(doc, ctx);
  return { text, map, length: text.length };
}
