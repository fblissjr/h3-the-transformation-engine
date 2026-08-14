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

let counter = 0;

/**
 * Monotonic, collision-free within a session and readable in a database viewer.
 * Deliberately not random: a stable id makes fixtures and logs diffable.
 */
function nextId(documentId: string): string {
  counter += 1;
  return `${documentId}:v${String(counter).padStart(4, '0')}`;
}

export async function recordVersion(params: {
  documentId: string;
  parentId: string | null;
  doc: H3Document;
  label: string;
  operations?: AppliedOperation[];
}): Promise<StoredVersion> {
  const version: StoredVersion = {
    id: nextId(params.documentId),
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
 */
export function buildTree(versions: StoredVersion[]): VersionNode[] {
  const nodes = new Map<string, VersionNode>(
    versions.map((v) => [v.id, { version: v, children: [], depth: 0 }]),
  );
  const roots: VersionNode[] = [];

  for (const node of nodes.values()) {
    const parentId = node.version.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
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
