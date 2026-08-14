/**
 * Applying a patch to a document.
 *
 * Three gates, in order, and a patch operation must clear all of them:
 *
 *   1. The path is on the allowlist in ir/paths.ts. Derived values stay derived;
 *      an open write surface is how shot indices and label ordinals stop being
 *      computed and start being guessed.
 *   2. The path already resolves. A hallucinated path is rejected rather than
 *      auto-created, because a field nothing reads is worse than an error.
 *   3. User-supplied dialogue is never altered. That is the one piece of content
 *      whose whole value is that it came through unchanged.
 *
 * Rejections are returned, never silently dropped. A patch that half-applied
 * without saying so is the failure mode that makes surgical editing untrustworthy.
 */

import type { H3Document } from '../ir/types';
import type { PatchOutput } from '../ir/schema';
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

    const before = getAtPath(next, op.path);
    if (before === op.value) {
      rejected.push({ path: op.path, reason: 'Value is unchanged.' });
      continue;
    }

    // visibleText is an array; a patch supplying a bare string would silently
    // change its type and break every consumer downstream.
    const coerced = Array.isArray(before) ? splitList(op.value) : op.value;

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

/** Newline- or comma-separated string into a trimmed list, dropping blanks. */
function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Undo an applied patch by writing the recorded `before` values back. */
export function revertPatch(doc: H3Document, applied: AppliedOperation[]): H3Document {
  let next = doc;
  for (const op of [...applied].reverse()) {
    next = setAtPath(next, op.path, op.before);
  }
  return next;
}
