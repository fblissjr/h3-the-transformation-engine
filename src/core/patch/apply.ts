/**
 * Applying a patch to a document.
 *
 * Four gates, in order, and a patch operation must clear all of them:
 *
 *   1. The path is on the allowlist in ir/paths.ts. Derived values stay derived;
 *      an open write surface is how shot indices and label ordinals stop being
 *      computed and start being guessed.
 *   2. The path already resolves. A hallucinated path is rejected rather than
 *      auto-created, because a field nothing reads is worse than an error.
 *   3. User-supplied dialogue is never altered. That is the one piece of content
 *      whose whole value is that it came through unchanged.
 *   4. The value fits the shape `H3DocumentSchema` gives that leaf. The
 *      allowlist says where a write may land and said nothing about what may
 *      land there, so a fractional cut time from the editor and the string
 *      "5200" from a model patch both went in and produced a document that
 *      failed its own schema on the next load. The shape is read off the
 *      document schema in ir/leaf.ts rather than restated here.
 *
 * Rejections are returned, never silently dropped. A patch that half-applied
 * without saying so is the failure mode that makes surgical editing untrustworthy.
 */

import type { H3Document } from '../ir/types';
import type { PatchOutput } from '../ir/schema';
import { coerceToLeaf, leafSchema } from '../ir/leaf';
import { getAtPath, isPatchable, parsePath, pathExists, setAtPath, toPathPattern } from '../ir/paths';

export interface AppliedOperation {
  path: string;
  before: unknown;
  after: unknown;
  rationale: string;
}

export interface RejectedOperation {
  path: string;
  reason: string;
}

export interface PatchResult {
  doc: H3Document;
  applied: AppliedOperation[];
  rejected: RejectedOperation[];
  /** Anything the model itself declined to do, passed through for the UI. */
  declined: { what: string; why: string }[];
}

/** True when a path points at the text of a line the user wrote. */
function isProtectedDialogue(doc: H3Document, path: string): boolean {
  if (toPathPattern(path) !== 'shots[].beats[].dialogue.text') return false;
  const segments = parsePath(path);
  const shotIndex = segments[1];
  const beatIndex = segments[3];
  if (typeof shotIndex !== 'number' || typeof beatIndex !== 'number') return false;
  return doc.shots[shotIndex]?.beats[beatIndex]?.dialogue?.userSupplied === true;
}

export function applyPatch(doc: H3Document, patch: PatchOutput): PatchResult {
  let next = doc;
  const applied: AppliedOperation[] = [];
  const rejected: RejectedOperation[] = [];

  for (const op of patch.operations) {
    if (!isPatchable(op.path)) {
      rejected.push({
        path: op.path,
        reason: `"${toPathPattern(op.path)}" is not an editable field. Structural changes go through a dedicated operation.`,
      });
      continue;
    }

    if (!pathExists(next, op.path)) {
      rejected.push({ path: op.path, reason: 'Path does not exist in this document.' });
      continue;
    }

    if (isProtectedDialogue(next, op.path)) {
      rejected.push({
        path: op.path,
        reason: 'This line was supplied by the user and must be reproduced exactly. Edit it directly instead.',
      });
      continue;
    }

    const pattern = toPathPattern(op.path);
    const leaf = leafSchema(pattern);
    if (!leaf) {
      // Refused rather than written blind: an allowlist entry the document
      // schema has no field for is a bug in the allowlist, and writing it would
      // put a key in the document that nothing can read back.
      rejected.push({
        path: op.path,
        reason: `"${pattern}" has no shape in the document schema.`,
      });
      continue;
    }

    const before = getAtPath(next, op.path);
    // Coerced before the comparison, or a model resending the current cut time
    // as text reads as a change and rewrites the number as a string.
    // visibleText is an array; a patch supplying a bare string would otherwise
    // silently change its type and break every consumer downstream.
    const coerced = coerceToLeaf(leaf, before, op.value);
    if (before === coerced) {
      rejected.push({ path: op.path, reason: 'Value is unchanged.' });
      continue;
    }

    const shape = leaf.safeParse(coerced);
    if (!shape.success) {
      rejected.push({
        path: op.path,
        reason: `Not a legal value for "${pattern}": ${shape.error.issues[0]?.message ?? 'wrong shape'}.`,
      });
      continue;
    }

    try {
      next = setAtPath(next, op.path, coerced);
      applied.push({ path: op.path, before, after: coerced, rationale: op.rationale });
    } catch (cause) {
      rejected.push({
        path: op.path,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  return { doc: next, applied, rejected, declined: patch.declined ?? [] };
}

/** Undo an applied patch by writing the recorded `before` values back. */
export function revertPatch(doc: H3Document, applied: AppliedOperation[]): H3Document {
  let next = doc;
  for (const op of [...applied].reverse()) {
    next = setAtPath(next, op.path, op.before);
  }
  return next;
}
