/**
 * Diagnostics.
 *
 * Errors only. There is no warning severity, on purpose.
 *
 * A diagnostic here means the document is provably malformed: a cut time
 * outside the video, a speaker id that was never declared, a retention marker
 * from the wrong vocabulary. Every one of those is decidable from structure
 * alone.
 *
 * Anything that pattern-matches free prose for a preference -- how many
 * sentences a soundscape "should" have, whether a description reached a word
 * target, whether a camera annotation is echoed in the wording -- was removed.
 * Those fire on legitimate output, and a check that cries wolf is worse than no
 * check: it trains you to ignore the ones that matter. Guidance of that kind
 * belongs in the planner prompt, where it costs nothing to be wrong.
 *
 * `path` is a document path, matching both the patch surface and the
 * serializer's source map -- that shared vocabulary is what makes click-to-fix
 * work without a translation layer.
 */

import type { H3Document, NormalizedContext } from '../ir/types';

export interface Diagnostic {
  /**
   * Stable machine-readable id. Never reworded, because the test suite asserts
   * on these and a rename would silently disarm a control.
   */
  code: string;
  /** Document path the problem lives at. */
  path: string;
  message: string;
}

export type Rule = (doc: H3Document, ctx: NormalizedContext) => Diagnostic[];

export function error(code: string, path: string, message: string): Diagnostic {
  return { code, path, message };
}
