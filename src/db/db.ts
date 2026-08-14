/**
 * IndexedDB.
 *
 * Five stores, not nineteen. The old project accumulated stores because it had
 * many loosely-related features; this one has a document, its history, and the
 * settings needed to produce it.
 *
 * Fresh-install only, deliberately. Breaking schema changes bump the version and
 * drop everything -- a solo tool where the artifacts are cheap to regenerate
 * does not earn the cost of migrations, and half-written migrations are a
 * reliable source of data loss.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { H3Document } from '../core/ir/types';

export const DB_NAME = 'H3TransformationEngine';
export const DB_VERSION = 1;

export interface StoredDocument {
  id: string;
  title: string;
  updatedAt: number;
  doc: H3Document;
  /** Version currently checked out, so a reload lands where the user left off. */
  headVersionId: string;
}

export interface StoredVersion {
  id: string;
  documentId: string;
  parentId: string | null;
  createdAt: number;
  /** Short human label, e.g. "made it night-time". */
  label: string;
  doc: H3Document;
  /** What changed, for the history view. Empty for the initial version. */
  operations: { path: string; before: unknown; after: unknown; rationale: string }[];
}

export interface StoredSetting {
  key: string;
  value: unknown;
}

interface H3Schema extends DBSchema {
  documents: { key: string; value: StoredDocument; indexes: { updatedAt: number } };
  versions: { key: string; value: StoredVersion; indexes: { documentId: string } };
  settings: { key: string; value: StoredSetting };
}

let dbPromise: Promise<IDBPDatabase<H3Schema>> | null = null;

export function db(): Promise<IDBPDatabase<H3Schema>> {
  dbPromise ??= openDB<H3Schema>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      const documents = database.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('updatedAt', 'updatedAt');

      const versions = database.createObjectStore('versions', { keyPath: 'id' });
      versions.createIndex('documentId', 'documentId');

      database.createObjectStore('settings', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function saveDocument(record: StoredDocument): Promise<void> {
  await (await db()).put('documents', record);
}

export async function loadDocument(id: string): Promise<StoredDocument | undefined> {
  return (await db()).get('documents', id);
}

export async function listDocuments(): Promise<StoredDocument[]> {
  const all = await (await db()).getAllFromIndex('documents', 'updatedAt');
  return all.reverse();
}

export async function deleteDocument(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['documents', 'versions'], 'readwrite');
  await tx.objectStore('documents').delete(id);
  // Versions are meaningless without their document, so they go too rather than
  // becoming orphans that quietly grow the database forever.
  const versions = tx.objectStore('versions');
  for (const version of await versions.index('documentId').getAll(id)) {
    await versions.delete(version.id);
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await db()).get('settings', key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', { key, value });
}
