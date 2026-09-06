/**
 * Erasing local state.
 *
 * This runs against `fake-indexeddb`, a real implementation of the IndexedDB
 * spec rather than a stub that returns whatever the test wants. Rows are really
 * written, the database is really deleted, and the counts asserted afterwards
 * come from reopening it. What that does not cover is browser-specific
 * behaviour -- eviction, partitioning, a delete blocked by another tab -- which
 * is why `erase` reports blocked databases instead of assuming success.
 *
 * The controls matter more than the happy path here. A wipe verifier that
 * cannot say "something is still there" is decoration, so each assertion that
 * something is gone is paired with a case where it is not.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Node has no Web Storage by default and the module reads it at call time.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage;

const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { handle } = await import('../server/routes');
const { open } = await import('../server/store');
const { saveDocument, setSetting } = await import('../src/db/db');
const { recordVersion } = await import('../src/db/versions');
const { API_KEY_NAME, getSecret, hasSecret, listSecretKeys, setSecret, vaultKeyCount } =
  await import('../src/crypto/secureStore');
const { describeResidue, erase, isClean, residueTotal, survey } = await import('../src/db/wipe');

const doc = {
  id: 'workspace',
  title: 't',
  idea: 'the idea that produced it',
  updatedAt: 1,
  doc: {} as never,
  headVersionId: 'workspace:v0001',
};

/** Seeded through the real seam, so the counts come from real rows. */
async function seed(): Promise<void> {
  await saveDocument(doc);
  await recordVersion({ documentId: 'workspace', parentId: null, doc: {} as never, label: 'Generated' });
  await recordVersion({
    documentId: 'workspace',
    parentId: 'workspace:v0001',
    doc: {} as never,
    label: 'Edited',
  });
  await setSetting('lastMode', 'T2VA');
  await setSecret(API_KEY_NAME, 'AIza-not-a-real-key');
}

const dirs: string[] = [];

beforeEach(async () => {
  const d = mkdtempSync(join(tmpdir(), 'h3-wipe-'));
  dirs.push(d);
  const databasePath = join(d, 'app.db');
  const ctx = { opened: open(databasePath), databasePath };
  // Routed to the real handler rather than stubbed: the whole property under
  // test is that the report says what STORAGE says, which a stub cannot show.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(new URL(String(input), 'http://seam.test'), init), ctx)) as typeof fetch;
  localStorage.clear();
  await erase('everything');
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('the survey sees what is actually there', () => {
  it('counts seeded state', async () => {
    // Non-vacuous: if this reported zero the erase assertions below would pass
    // without erasing anything.
    await seed();
    const residue = await survey();
    // The full object, not a subset. `runs` is on it deliberately: it holds
    // `raw_output`, which is prompt text, so a survey that stopped covering it
    // would let the button report a clean erase with every prompt still on
    // disk. Adding a table to ERASABLE without thinking turns this red, which
    // is the behaviour worth having.
    expect(residue.rows).toEqual({
      documents: 1,
      versions: 2,
      settings: 1,
      runs: 0,
      arms: 0,
      experiments: 0,
    });
    expect(residue.vaultKeys).toBe(1);
    expect(residue.secrets).toEqual(['h3-secure:gemini-api-key']);
    expect(residueTotal(residue)).toBe(6);
  });

  it('finds secrets by prefix, not by a known name', async () => {
    // The erase must not miss a secret written by some other code path.
    localStorage.setItem('h3-secure:something-else', '{}');
    localStorage.setItem('unrelated-key', 'x');
    expect(listSecretKeys()).toEqual(['h3-secure:something-else']);
  });
});

describe('the verifier can report red', () => {
  it('calls populated state unclean at both scopes', async () => {
    await seed();
    const residue = await survey();
    expect(isClean(residue, 'documents')).toBe(false);
    expect(isClean(residue, 'everything')).toBe(false);
    expect(describeResidue(residue, 'everything')).toBe(
      '1 in documents, 2 in versions, 1 in settings, 1 wrapping key, 1 stored secret',
    );
  });

  it('calls a leftover secret unclean at everything scope and clean at documents scope', async () => {
    // The discriminating case. A surviving key is correct after a documents
    // erase and a failure after an everything erase, and one boolean has to
    // mean both.
    await setSecret(API_KEY_NAME, 'AIza-not-a-real-key');
    const residue = await survey();
    expect(isClean(residue, 'documents')).toBe(true);
    expect(isClean(residue, 'everything')).toBe(false);
    expect(describeResidue(residue, 'documents')).toBe('');
    expect(describeResidue(residue, 'everything')).toBe('1 wrapping key, 1 stored secret');
  });

  it('notices a single leftover row', async () => {
    await setSetting('lastMode', 'T2VA');
    const residue = await survey();
    expect(isClean(residue, 'documents')).toBe(false);
    expect(describeResidue(residue, 'documents')).toBe('1 in settings');
  });
});

describe('erase documents', () => {
  it('removes documents, versions and settings', async () => {
    await seed();
    const report = await erase('documents');

    expect(residueTotal(report.before)).toBe(6);
    expect(report.after.rows).toEqual({
      documents: 0,
      versions: 0,
      settings: 0,
      runs: 0,
      arms: 0,
      experiments: 0,
    });
    expect(report.blocked).toEqual([]);
    expect(report.clean).toBe(true);
  });

  it('leaves the API key usable', async () => {
    await seed();
    await erase('documents');

    expect(hasSecret(API_KEY_NAME)).toBe(true);
    expect(await getSecret(API_KEY_NAME)).toBe('AIza-not-a-real-key');
  });

  /**
   * The IndexedDB form of this guarded a memoised connection surviving the
   * delete and still serving rows from a database that was gone. That handle no
   * longer exists -- the store is behind HTTP and the server holds the only
   * connection -- but the property it protected does: after an erase, a READ
   * has to come back empty, not merely the report.
   */
  it('leaves storage that reads as empty, not just a report that says so', async () => {
    await seed();
    await erase('documents');
    const { listDocuments, loadDocument } = await import('../src/db/db');
    const { listVersions } = await import('../src/db/versions');
    expect(await listDocuments()).toEqual([]);
    expect(await loadDocument('workspace')).toBeUndefined();
    expect(await listVersions('workspace')).toEqual([]);
  });
});

describe('erase everything', () => {
  it('removes the documents, the secrets and the wrapping key', async () => {
    await seed();
    const report = await erase('everything');

    expect(residueTotal(report.before)).toBe(6);
    expect(residueTotal(report.after)).toBe(0);
    expect(report.blocked).toEqual([]);
    expect(report.clean).toBe(true);
    expect(describeResidue(report.after, 'everything')).toBe('');
  });

  it('makes the stored key unreadable, not merely delisted', async () => {
    await seed();
    await erase('everything');

    expect(hasSecret(API_KEY_NAME)).toBe(false);
    expect(await getSecret(API_KEY_NAME)).toBeNull();
    expect(await vaultKeyCount()).toBe(0);
  });

  it('is safe to run twice', async () => {
    await seed();
    await erase('everything');
    const second = await erase('everything');

    expect(residueTotal(second.before)).toBe(0);
    expect(second.clean).toBe(true);
  });

  it('works when there was nothing to erase', async () => {
    const report = await erase('everything');
    expect(report.clean).toBe(true);
    expect(residueTotal(report.after)).toBe(0);
  });
});
