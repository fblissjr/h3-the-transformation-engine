/**
 * Immutable version history.
 *
 * Every applied edit -- direct, surgical, or wide -- creates a new version with
 * a parent pointer and the operations that produced it. Nothing is ever mutated
 * in place, so checking out an earlier version and editing from there branches
 * rather than overwrites.
 *
 * This is what makes surgical editing safe to use: a wide edit that goes wrong
 * is one checkout away from being undone, and the operation list says exactly
 * what it did.
 */

import type { H3Document } from '../core/ir/types';
import type { AppliedOperation } from '../core/patch/apply';
import { db, type StoredVersion } from './db';
import { trace } from '../debug';

/**
 * The next free id, read from storage rather than counted in memory.
 *
 * This was a module-level `let counter = 0`, described as "monotonic,
 * collision-free within a session". Both halves were true and the qualifier was
 * the bug: the counter resets on every page load, while `put` overwrites by key.
 * So the first version recorded after a reload was written to `v0001` -- on top
 * of whatever `v0001` already held. It destroyed the root of a real history, and
 * it would have destroyed one more version per reload, silently, forever.
 *
 * It also produced a version whose `parentId` was its own id, because the head
 * being replaced was the id being written. See the cycle guard in `buildTree`.
 *
 * Storage is the only thing that knows what has been used, so storage is what is
 * asked. Ids stay readable and diffable, which is what the counter was for; what
 * they stop being is a function of how many times the page has been opened.
 *
 * Not safe against two writers racing, and it does not need to be: the app
 * issues one call at a time and this runs after the model returns. A second
 * writer would have to be a second tab, which would already be fighting over
 * `documents` as well.
 */
async function nextId(documentId: string): Promise<string> {
  const keys = await (await db()).getAllKeysFromIndex('versions', 'documentId', documentId);
  const prefix = `${documentId}:v`;
  const highest = keys.reduce((max, key) => {
    if (typeof key !== 'string' || !key.startsWith(prefix)) return max;
    // A suffix this build did not write is skipped rather than guessed at, so
    // an id from a future scheme cannot drag the sequence backwards.
    const n = Number.parseInt(key.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

export async function recordVersion(params: {
  documentId: string;
  parentId: string | null;
  doc: H3Document;
  label: string;
  operations?: AppliedOperation[];
}): Promise<StoredVersion> {
  const version: StoredVersion = {
    id: await nextId(params.documentId),
    documentId: params.documentId,
    parentId: params.parentId,
    createdAt: Date.now(),
    label: params.label,
    doc: params.doc,
    operations: (params.operations ?? []).map((o) => ({
      path: o.path,
      before: o.before,
      after: o.after,
      rationale: o.rationale,
    })),
  };
  await (await db()).put('versions', version);
  trace('storage', 'storage.recordVersion', `recorded ${version.id} "${version.label}"`, {
    id: version.id,
    parentId: version.parentId,
    label: version.label,
    // Which paths this version changed, not the document -- the document is
    // already described by `pipeline.assemble` and repeating it here would
    // spend the buffer's budget on a copy.
    operations: version.operations.map((o) => o.path),
  });
  return version;
}

export async function listVersions(documentId: string): Promise<StoredVersion[]> {
  const all = await (await db()).getAllFromIndex('versions', 'documentId', documentId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getVersion(id: string): Promise<StoredVersion | undefined> {
  return (await db()).get('versions', id);
}

export interface VersionNode {
  version: StoredVersion;
  children: VersionNode[];
  depth: number;
}

/**
 * Build the branch tree.
 *
 * Orphans -- versions whose parent was deleted -- are attached at the root
 * rather than dropped. Silently hiding history because a link broke is how a
 * user loses work they can still see referenced elsewhere.
 *
 * A version inside a parent cycle is treated as an orphan, for exactly that
 * reason. This is not hypothetical: the id counter used to reset per page load,
 * which wrote a version whose `parentId` was its own id. A self-parent is never
 * pushed to `roots` and becomes its own child, so with the rest of the history
 * chained beneath it the root list came out EMPTY and the panel said "No
 * versions yet" over six stored versions. The write bug is fixed in `nextId`
 * above; this stays because the damaged rows are still on disk, and because a
 * cycle must degrade to a visible orphan rather than to silence.
 */
export function buildTree(versions: StoredVersion[]): VersionNode[] {
  const nodes = new Map<string, VersionNode>(
    versions.map((v) => [v.id, { version: v, children: [], depth: 0 }]),
  );
  const roots: VersionNode[] = [];

  /**
   * Whether following parents from `id` comes back to `id` itself.
   *
   * The distinction is the whole of it, and the first version of this check got
   * it wrong in a way the test caught: a node merely DESCENDED from a cycle is
   * not in one. Returning true for those detached every child of the damaged
   * root and scattered the history across three roots instead of showing one
   * tree. Only a chain that closes on the node being asked about counts.
   */
  const inCycle = (id: string): boolean => {
    const seen = new Set<string>([id]);
    let cursor: string | null = nodes.get(id)?.version.parentId ?? null;
    while (cursor != null && nodes.has(cursor)) {
      if (cursor === id) return true;
      // A different cycle upstream: we are below it, not part of it.
      if (seen.has(cursor)) return false;
      seen.add(cursor);
      cursor = nodes.get(cursor)?.version.parentId ?? null;
    }
    return false;
  };

  for (const node of nodes.values()) {
    const parentId = node.version.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && !inCycle(node.version.id)) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (node: VersionNode, depth: number): void => {
    node.depth = depth;
    node.children.sort((a, b) => a.version.createdAt - b.version.createdAt);
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  roots.sort((a, b) => a.version.createdAt - b.version.createdAt);
  for (const root of roots) assignDepth(root, 0);

  return roots;
}

/** Depth-first flattening, for rendering the tree as an indented list. */
export function flattenTree(roots: VersionNode[]): VersionNode[] {
  const out: VersionNode[] = [];
  const walk = (node: VersionNode): void => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** The chain from a version back to its root, oldest first. */
export function ancestryOf(versions: StoredVersion[], id: string): StoredVersion[] {
  const byId = new Map(versions.map((v) => [v.id, v]));
  const chain: StoredVersion[] = [];
  let cursor = byId.get(id);
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}
