/**
 * The storage seam, over HTTP.
 *
 * This file used to guard an IndexedDB wedge: `openDB(name, 1, ...)` skips its
 * `upgrade` when the database already sits at version 1, so a store could exist
 * without its object stores and every call afterwards threw `NotFoundError`
 * with nothing to explain it. That wedge cannot happen against SQLite, and the
 * property that replaced it -- opening an existing database must never reset it
 * -- is asserted in `test/store.test.ts` under "keeps the rows that were already
 * there". Those four repair cases are retired rather than ported, and this note
 * is what says so out loud.
 *
 * What did NOT retire is the pairing this repo insists on: it is REPORTED, and
 * it still OPENED. A build that refuses to return what the previous build wrote
 * loses work that exists nowhere else, so `loadDocument` hands back the record
 * together with `schemaError`. `fake-indexeddb` was only ever the harness for
 * that; the property is about the seam, and it is exercised here against the
 * real store.
 *
 * `fetch` is routed to the actual route handler rather than stubbed. A stub
 * would make this green whether or not any server code ran, which is the
 * across-a-boundary hollow green this repo keeps finding.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handle, type ServerContext } from '../server/routes';
import { open } from '../server/store';
import { buildTree, flattenTree } from '../src/db/versions';
import { listDocuments, loadDocument, saveDocument } from '../src/db/db';
import { recordVersion, listVersions } from '../src/db/versions';
import { describeSchemaFailure } from '../src/core/ir/schema';
import { t2vaBaker } from './fixtures/guide-examples';

const dirs: string[] = [];
let ctx: ServerContext;

beforeEach(() => {
  const d = mkdtempSync(join(tmpdir(), 'h3-seam-'));
  dirs.push(d);
  const databasePath = join(d, 'app.db');
  ctx = { opened: open(databasePath), databasePath };
  // The seam calls `fetch('/api/...')`. Routing it into `handle` means these
  // tests execute the routing, the state checks and the SQL, not a fake.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(new URL(String(input), 'http://seam.test'), init), ctx)) as typeof fetch;
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const record = (id: string, doc: unknown = t2vaBaker, idea = `idea behind ${id}`) => ({
  id,
  title: `title of ${id}`,
  idea,
  updatedAt: 1_700_000_000_000,
  doc: doc as never,
  headVersionId: `${id}:v0001`,
});

describe('the seam round-trips through the real routes', () => {
  it('saves and reads a document', async () => {
    await saveDocument(record('d1'));
    expect((await loadDocument('d1'))?.record.doc).toEqual(t2vaBaker);
  });

  it('lists documents', async () => {
    await saveDocument(record('d1'));
    expect((await listDocuments()).map((d) => d.id)).toEqual(['d1']);
  });

  it('returns undefined for a document that is not there', async () => {
    expect(await loadDocument('nope')).toBeUndefined();
  });

  it('carries the expanded idea, which nothing persisted before', async () => {
    await saveDocument(record('d1', t2vaBaker, 'a baker at dawn'));
    expect((await loadDocument('d1'))!.record.idea).toBe('a baker at dawn');
  });
});

describe('a stored document that does not match the schema', () => {
  it('reports nothing for a document that parses', () => {
    expect(describeSchemaFailure(t2vaBaker)).toBeNull();
  });

  it('names the offending path', () => {
    expect(describeSchemaFailure({ ...t2vaBaker, shots: [] })).toMatch(/^shots: /);
  });

  /**
   * The pairing, and the reason this file still exists. Both halves in one test
   * on purpose: asserting only that it is reported would pass just as well if
   * the record had been withheld.
   */
  it('is still returned by loadDocument, with the failure alongside it', async () => {
    await saveDocument(record('d1', { schemaVersion: '1.0.0', id: 'd1', mode: 'NOT_A_MODE' }));
    const got = await loadDocument('d1');
    expect(got, 'it still opened').toBeDefined();
    expect(got!.schemaError, 'and it was reported').not.toBeNull();
    expect(got!.record.doc).toMatchObject({ mode: 'NOT_A_MODE' });
  });

  it('reports nothing for a document that round-trips intact', async () => {
    await saveDocument(record('d1'));
    expect((await loadDocument('d1'))!.schemaError).toBeNull();
  });
});

describe('version ids come from storage, not from an in-memory count', () => {
  /**
   * The sequence is allocated inside one SQLite transaction on the server now.
   * Reading the highest id and then writing separately is a read-then-write
   * race, and it was reachable: two edits could resolve the same id and the
   * second write would destroy the first row.
   */
  it('continues the sequence from what storage holds', async () => {
    await saveDocument(record('d1'));
    const first = await recordVersion({
      documentId: 'd1',
      parentId: null,
      doc: t2vaBaker as never,
      label: 'first',
    });
    const second = await recordVersion({
      documentId: 'd1',
      parentId: first.id,
      doc: t2vaBaker as never,
      label: 'second',
    });
    expect(first.id).toBe('d1:v0001');
    expect(second.id).toBe('d1:v0002');
    expect((await listVersions('d1')).map((v) => v.id)).toEqual(['d1:v0001', 'd1:v0002']);
  });

  it('roots the first version on itself and inherits the root afterwards', async () => {
    await saveDocument(record('d1'));
    const first = await recordVersion({
      documentId: 'd1',
      parentId: null,
      doc: t2vaBaker as never,
      label: 'first',
    });
    const second = await recordVersion({
      documentId: 'd1',
      parentId: first.id,
      doc: t2vaBaker as never,
      label: 'second',
    });
    expect(first.rootId).toBe(first.id);
    expect(second.rootId).toBe(first.id);
  });
});

describe('a damaged history still renders', () => {
  const v = (id: string, parentId: string | null) => ({
    id,
    documentId: 'd1',
    parentId,
    rootId: id,
    createdAt: 1,
    label: id,
    doc: t2vaBaker as never,
    operations: [],
  });

  it('renders a self-parented version as a root instead of losing the whole tree', () => {
    expect(flattenTree(buildTree([v('a', 'a')])).map((n) => n.version.id)).toEqual(['a']);
  });

  it('does not lose a longer cycle either', () => {
    const flat = flattenTree(buildTree([v('a', 'b'), v('b', 'a')])).map((n) => n.version.id);
    expect(flat.sort()).toEqual(['a', 'b']);
  });
});
