/**
 * Opening the document database when its schema is incomplete.
 *
 * The wedge these guard against is silent and permanent: `openDB(name, 1, ...)`
 * skips its `upgrade` when the database already sits at version 1, so a
 * `H3TransformationEngine` that exists without stores never gets any, and every
 * call afterwards throws `NotFoundError` with nothing to explain it. The same
 * bug was hit for real in the key vault, by a stray `indexedDB.open` on the
 * origin -- which is all it takes to create one.
 *
 * Each case asserts its own precondition before exercising the repair, so a
 * test cannot pass by failing to set up the broken state it claims to test.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const { closeDb, db, DB_NAME, STORES } = await import('../src/db/db');
const { listVersions, recordVersion } = await import('../src/db/versions');
const { listDocuments, saveDocument } = await import('../src/db/db');

const doc = {
  id: 'workspace',
  title: 'first',
  updatedAt: 1,
  doc: {} as never,
  headVersionId: 'v1',
};

/** Open a raw database at a chosen version and let a callback shape it. */
function rawOpen(version: number, upgrade?: (database: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    if (upgrade) request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function wipe(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  await closeDb();
  await wipe();
});

describe('a fresh database', () => {
  it('gets every store and index', async () => {
    const database = await db();
    expect([...database.objectStoreNames].sort()).toEqual([...STORES].sort());

    const tx = database.transaction(['documents', 'versions'], 'readonly');
    expect(tx.objectStore('documents').indexNames.contains('updatedAt')).toBe(true);
    expect(tx.objectStore('versions').indexNames.contains('documentId')).toBe(true);
  });

  it('reads and writes through the indexes', async () => {
    await saveDocument(doc);
    await recordVersion({ documentId: 'workspace', parentId: null, doc: {} as never, label: 'Generated' });

    expect((await listDocuments()).map((d) => d.id)).toEqual(['workspace']);
    expect(await listVersions('workspace')).toHaveLength(1);
  });
});

describe('a database that exists at version 1 with no stores', () => {
  async function createEmptyAtVersion1(): Promise<void> {
    const raw = await rawOpen(1);
    // The precondition is the point: exactly what a stray `indexedDB.open`
    // leaves behind.
    expect(raw.version).toBe(1);
    expect([...raw.objectStoreNames]).toEqual([]);
    raw.close();
  }

  it('is repaired rather than throwing forever', async () => {
    await createEmptyAtVersion1();

    const database = await db();
    expect([...database.objectStoreNames].sort()).toEqual([...STORES].sort());
  });

  it('works end to end afterwards', async () => {
    await createEmptyAtVersion1();

    await saveDocument(doc);
    await recordVersion({ documentId: 'workspace', parentId: null, doc: {} as never, label: 'Generated' });

    expect((await listDocuments()).map((d) => d.id)).toEqual(['workspace']);
    expect(await listVersions('workspace')).toHaveLength(1);
  });
});

describe('a database missing only one store', () => {
  it('gains the missing store and keeps the rows in the others', async () => {
    const raw = await rawOpen(1, (database) => {
      const documents = database.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('updatedAt', 'updatedAt');
      const versions = database.createObjectStore('versions', { keyPath: 'id' });
      versions.createIndex('documentId', 'documentId');
      // `settings` deliberately absent.
    });
    expect([...raw.objectStoreNames].sort()).toEqual(['documents', 'versions']);
    await new Promise<void>((resolve, reject) => {
      const tx = raw.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    raw.close();

    const database = await db();
    expect([...database.objectStoreNames].sort()).toEqual([...STORES].sort());
    // Repair must not be a disguised reset.
    expect(await database.get('documents', 'workspace')).toMatchObject({ id: 'workspace', title: 'first' });
  });
});

describe('a store that exists without its index', () => {
  it('gains the index instead of failing on first use', async () => {
    const raw = await rawOpen(1, (database) => {
      database.createObjectStore('documents', { keyPath: 'id' });
      database.createObjectStore('versions', { keyPath: 'id' });
      database.createObjectStore('settings', { keyPath: 'key' });
      // Every store present, no indexes -- `listDocuments` and `listVersions`
      // both read through one, so this breaks as silently as a missing store.
    });
    const check = raw.transaction(['documents', 'versions'], 'readonly');
    expect(check.objectStore('documents').indexNames.contains('updatedAt')).toBe(false);
    expect(check.objectStore('versions').indexNames.contains('documentId')).toBe(false);
    raw.close();

    await saveDocument(doc);
    await recordVersion({ documentId: 'workspace', parentId: null, doc: {} as never, label: 'Generated' });

    expect((await listDocuments()).map((d) => d.id)).toEqual(['workspace']);
    expect(await listVersions('workspace')).toHaveLength(1);
  });
});
