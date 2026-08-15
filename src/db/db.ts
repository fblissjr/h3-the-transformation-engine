/**
 * IndexedDB.
 *
 * Three stores, not nineteen. The old project accumulated stores because it had
 * many loosely-related features; this one has a document, its history, and the
 * settings needed to produce it.
 *
 * No data migrations, deliberately. A solo tool whose artifacts are cheap to
 * regenerate does not earn the cost of them, and half-written migrations are a
 * reliable source of data loss.
 *
 * That is separate from schema repair, which this does do. The version number
 * is not the source of truth about what exists -- see `openHealed` below.
 */

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type { H3Document } from '../core/ir/types';

export const DB_NAME = 'H3TransformationEngine';

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

export const STORES = ['documents', 'versions', 'settings'] as const;
export type StoreName = (typeof STORES)[number];

type UpgradeDatabase = IDBPDatabase<H3Schema>;
type UpgradeTransaction = IDBPTransaction<H3Schema, StoreName[], 'versionchange'>;

/**
 * Bring a database up to the expected schema, creating only what is missing.
 *
 * Every step is guarded rather than assumed, because this runs both on a fresh
 * install and as a repair, and `createObjectStore` on a store that already
 * exists throws `ConstraintError`.
 */
function ensureSchema(database: UpgradeDatabase, transaction: UpgradeTransaction): void {
  const documents = database.objectStoreNames.contains('documents')
    ? transaction.objectStore('documents')
    : database.createObjectStore('documents', { keyPath: 'id' });
  if (!documents.indexNames.contains('updatedAt')) documents.createIndex('updatedAt', 'updatedAt');

  const versions = database.objectStoreNames.contains('versions')
    ? transaction.objectStore('versions')
    : database.createObjectStore('versions', { keyPath: 'id' });
  if (!versions.indexNames.contains('documentId')) versions.createIndex('documentId', 'documentId');

  if (!database.objectStoreNames.contains('settings')) {
    database.createObjectStore('settings', { keyPath: 'key' });
  }
}

/**
 * Whether the database has every store and index the app reads.
 *
 * Indexes are checked, not just stores. A `versions` store without its
 * `documentId` index fails exactly as silently as a missing store -- the
 * history view throws and nothing says why.
 */
function schemaComplete(database: IDBPDatabase<H3Schema>): boolean {
  if (!STORES.every((store) => database.objectStoreNames.contains(store))) return false;

  // A read-only transaction with no requests settles on its own.
  const transaction = database.transaction(['documents', 'versions'], 'readonly');
  return (
    transaction.objectStore('documents').indexNames.contains('updatedAt') &&
    transaction.objectStore('versions').indexNames.contains('documentId')
  );
}

/**
 * Open the database, repairing an incomplete schema.
 *
 * The version is deliberately never named on the first open. `openDB(name, 1,
 * ...)` skips `upgrade` when the database already sits at version 1, so a
 * `H3TransformationEngine` created empty by something else on this origin --
 * a stray `indexedDB.open`, a half-finished upgrade -- would never get its
 * stores, and every call after that throws `NotFoundError` with nothing to
 * explain it. Asking for version 1 again after a repair fails the other way,
 * with `VersionError`.
 *
 * So the schema, not the version number, is the test. This mirrors the key
 * vault in `src/crypto/secureStore.ts`, where the same wedge was hit for real.
 */
async function openHealed(): Promise<IDBPDatabase<H3Schema>> {
  const existing = await openDB<H3Schema>(DB_NAME);
  if (schemaComplete(existing)) return existing;

  const next = existing.version + 1;
  existing.close();
  return openDB<H3Schema>(DB_NAME, next, { upgrade: (database, _old, _new, tx) => ensureSchema(database, tx) });
}

export function db(): Promise<IDBPDatabase<H3Schema>> {
  dbPromise ??= openHealed();
  return dbPromise;
}

/**
 * Close the connection and drop the memoised handle.
 *
 * Required before deleting the database: an open connection blocks
 * `deleteDatabase` indefinitely, and a cached promise handed out afterwards
 * would point at a database that no longer exists. Erasing without this is the
 * failure mode where the wipe reports success and nothing was removed.
 */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (pending) (await pending).close();
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
