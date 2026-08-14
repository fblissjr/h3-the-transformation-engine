/**
 * Diagnostics.
 *
 * Every rule reports through this shape so the UI can render one list, sort it,
 * and jump to the offending node. `path` is a document path, matching both the
 * patch surface and the serializer's source map -- that shared vocabulary is
 * what makes click-to-fix work without a translation layer.
 */

import type { H3Document, NormalizedContext } from '../ir/types';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /**
   * Stable machine-readable id. Never reworded, because the test suite asserts
   * on these and a rename would silently disarm a control.
   */
  code: string;
  severity: Severity;
  /** Document path the problem lives at. */
  path: string;
  message: string;
}

export type Rule = (doc: H3Document, ctx: NormalizedContext) => Diagnostic[];

export function error(code: string, path: string, message: string): Diagnostic {
  return { code, severity: 'error', path, message };
}

export function warn(code: string, path: string, message: string): Diagnostic {
  return { code, severity: 'warning', path, message };
}
