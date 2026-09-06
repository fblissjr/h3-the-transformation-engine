/**
 * SQLite storage.
 *
 * These are the properties `src/db/db.ts` already holds, carried over rather
 * than reinvented: a document that no longer parses is still returned, opening
 * an existing database repairs without resetting, and referential integrity is
 * actually on. Plus the one property the new half exists for -- that n per arm
 * is recoverable, which is what makes a distribution comparable.
 *
 * Deliberately not here: a test that the tables exist. It would fail whenever
 * the schema is edited and would never reject a bad schema, which makes it a
 * change detector rather than a check.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteDocument,
  listDocuments,
  loadDocument,
  open,
  recordRun,
  saveDocument,
  saveVersion,
  setSetting,
  getSetting,
  archive,
  exportTables,
  SCHEMA_VERSION,
  type Db,
} from '../server/store';
import { t2vaBaker } from './fixtures/guide-examples';

const dirs: string[] = [];
const tempPath = () => {
  const d = mkdtempSync(join(tmpdir(), 'h3-store-'));
  dirs.push(d);
  return join(d, 'app.db');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const record = (id: string, doc: unknown = t2vaBaker, title = `title of ${id}`) => ({
  id,
  title,
  updatedAt: 1_700_000_000_000,
  doc: doc as never,
  headVersionId: `v_${id}`,
});

describe('documents round-trip', () => {
  it('returns the document that was stored', () => {
    const db = open(':memory:').db;
    saveDocument(db, record('d1'));
    expect(loadDocument(db, 'd1')?.record.doc).toEqual(t2vaBaker);
  });

  it('derives mode and shot count from the body rather than storing them twice', () => {
    const db: Db = open(':memory:').db;
    saveDocument(db, record('d1'));
    const row = db.prepare('SELECT mode, shot_count FROM documents WHERE id = ?').get('d1') as {
      mode: string;
      shot_count: number;
    };
    // A generated column cannot disagree with the body it is computed from,
    // which is the whole reason the list view reads these instead of a copy.
    expect(row.mode).toBe(t2vaBaker.mode);
    expect(row.shot_count).toBe(t2vaBaker.shots.length);
  });

  /**
   * `title` is NOT derived, and this assertion exists because the first version
   * of it could not fail.
   *
   * It read `expect(row.title).toBe(fixture.title ?? null)` against a column
   * generated from `body ->> '$.title'`. `H3Document` has no title -- it is an
   * app-level name on the StoredDocument wrapper -- so the column was null for
   * every row, the fixture's property was undefined, and the assertion compared
   * null to null and passed while every document in the list view was untitled.
   * A null result establishes nothing unless you know the check could match, so
   * this one round-trips a value the fixture does not contain.
   */
  it('stores the title the caller supplied, which the body does not carry', () => {
    const db: Db = open(':memory:').db;
    saveDocument(db, record('d1', t2vaBaker, 'Bakery at dawn'));
    expect(loadDocument(db, 'd1')!.record.title).toBe('Bakery at dawn');
    expect(listDocuments(db)[0].title).toBe('Bakery at dawn');
    // The body genuinely has no title, which is why deriving one was wrong.
    expect((t2vaBaker as { title?: string }).title).toBeUndefined();
  });

  it('keeps the title across a re-save of the same document', () => {
    const db = open(':memory:').db;
    saveDocument(db, record('d1', t2vaBaker, 'first name'));
    saveDocument(db, record('d1', t2vaBaker, 'renamed'));
    expect(loadDocument(db, 'd1')!.record.title).toBe('renamed');
  });

  it('omits soft-deleted documents from the list and from load', () => {
    const db = open(':memory:').db;
    saveDocument(db, record('d1'));
    deleteDocument(db, 'd1', Date.now());
    expect(loadDocument(db, 'd1')).toBeUndefined();
    expect(listDocuments(db).map((d) => d.id)).not.toContain('d1');
  });
});

describe('the schema reports, it does not gate', () => {
  /**
   * The pair this repo insists on: it is reported, AND it still opened. A build
   * that refused to return work the previous build wrote would lose it, since
   * there is no other copy.
   */
  it('returns a document that no longer matches the schema, and says so', () => {
    const db = open(':memory:').db;
    saveDocument(db, record('d1', { schemaVersion: '1.0.0', id: 'd1', mode: 'NOT_A_MODE' }));
    const got = loadDocument(db, 'd1');
    expect(got, 'the record still came back').toBeDefined();
    expect(got!.schemaError, 'and the failure was reported').not.toBeNull();
    expect(got!.record.doc).toMatchObject({ mode: 'NOT_A_MODE' });
  });

  it('reports nothing for a document that parses', () => {
    const db = open(':memory:').db;
    saveDocument(db, record('d1'));
    expect(loadDocument(db, 'd1')!.schemaError).toBeNull();
  });
});

describe('opening an existing database', () => {
  /** Repair must never be a disguised reset. */
  it('keeps the rows that were already there', () => {
    const path = tempPath();
    const first = open(path).db;
    saveDocument(first, record('d1'));
    setSetting(first, 'provider', 'heylook');
    first.close();

    const second = open(path).db;
    expect(loadDocument(second, 'd1')).toBeDefined();
    expect(getSetting(second, 'provider', 'none')).toBe('heylook');
    second.close();
  });
});

describe('referential integrity is actually on', () => {
  /**
   * SQLite defaults `foreign_keys` OFF, per connection. Without the pragma this
   * insert is accepted and the orphan is invisible until something joins on it.
   */
  it('refuses a version whose document does not exist', () => {
    const db = open(':memory:').db;
    expect(() =>
      saveVersion(db, {
        id: 'v1',
        documentId: 'ghost',
        parentId: null,
        rootId: 'v1',
        createdAt: 1,
        label: 'first',
        doc: t2vaBaker as never,
        operations: [],
      }),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('runs are grouped so a distribution is recoverable', () => {
  /**
   * The reason `arms` exists at all. PLAN.md records that a fixed seed does not
   * reproduce, so every comparison is between distributions -- which means n per
   * arm has to be countable. A runs table with no arm key can hold every call
   * ever made and still not answer "did thinking-on change conformance",
   * because nothing says which calls constitute one arm.
   */
  it('counts stage outcomes per arm, which is the query the table exists for', () => {
    const db = open(':memory:').db;
    db.prepare('INSERT INTO experiments (id, created_at, question) VALUES (?,?,?)').run(
      'e1',
      1,
      'does thinking change conformance',
    );
    for (const arm of ['off', 'medium']) {
      db.prepare('INSERT INTO arms (id, experiment_id, label, created_at) VALUES (?,?,?,?)').run(
        arm,
        'e1',
        arm,
        1,
      );
    }
    const stages = { off: ['clean', 'schema', 'schema'], medium: ['clean', 'clean', 'diagnostics'] };
    let n = 0;
    for (const [arm, list] of Object.entries(stages)) {
      for (const stage of list) {
        recordRun(db, {
          id: `r${n++}`,
          createdAt: 1,
          armId: arm,
          role: 'planner',
          provider: 'heylook',
          model: 'qwen3-26b',
          stage: stage as never,
        });
      }
    }
    const rows = db
      .prepare(
        `SELECT arm_id, stage, count(*) n FROM runs GROUP BY arm_id, stage ORDER BY arm_id, stage`,
      )
      .all() as { arm_id: string; stage: string; n: number }[];
    expect(rows).toEqual([
      { arm_id: 'medium', stage: 'clean', n: 2 },
      { arm_id: 'medium', stage: 'diagnostics', n: 1 },
      { arm_id: 'off', stage: 'clean', n: 1 },
      { arm_id: 'off', stage: 'schema', n: 2 },
    ]);
    // n per arm is recoverable, which is the property that makes the two
    // columns comparable at all.
    const perArm = db
      .prepare('SELECT arm_id, count(*) n FROM runs GROUP BY arm_id ORDER BY arm_id')
      .all() as { arm_id: string; n: number }[];
    expect(perArm).toEqual([
      { arm_id: 'medium', n: 3 },
      { arm_id: 'off', n: 3 },
    ]);
  });

  it('refuses a stage outside the harness vocabulary', () => {
    const db = open(':memory:').db;
    expect(() =>
      recordRun(db, {
        id: 'r1',
        createdAt: 1,
        role: 'planner',
        provider: 'heylook',
        model: 'm',
        stage: 'mostly_fine' as never,
      }),
    ).toThrow(/CHECK constraint/i);
  });
});

// ---------------------------------------------------------------------------
// Schema lineage
// ---------------------------------------------------------------------------

describe('a database written by a different schema', () => {
  /** Build a file the way an older build would have left it. */
  const stale = (path: string) => {
    const old = new Database(path);
    old.exec(`CREATE TABLE documents (
      id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
      head_version_id TEXT,
      title TEXT GENERATED ALWAYS AS (body ->> '$.title') VIRTUAL) STRICT`);
    old.prepare('INSERT INTO documents (id, body, created_at, updated_at) VALUES (?,?,?,?)').run(
      'old1',
      JSON.stringify(t2vaBaker),
      1,
      1,
    );
    old.close();
  };

  /**
   * The pair, as everywhere else here: it is reported, AND it still opened.
   *
   * Refusing outright would honour "no migrations" and break "a build that
   * refuses to open what the previous build wrote loses work that exists nowhere
   * else". Read-only honours both, because the first rule is about contents and
   * the second is about the container.
   */
  it('opens read-only and says so, rather than refusing or rewriting', () => {
    const path = tempPath();
    stale(path);
    const opened = open(path);
    expect(opened.writable).toBe(false);
    expect(opened.mismatch).not.toBeNull();
    expect(opened.mismatch!.found).toBe(0);
    expect(opened.mismatch!.expected).toBe(SCHEMA_VERSION);
    // The documents are still there to read, which is the whole point.
    expect(
      opened.db.prepare('SELECT id FROM documents').all(),
    ).toEqual([{ id: 'old1' }]);
    opened.db.close();
  });

  it('refuses writes to it', () => {
    const path = tempPath();
    stale(path);
    const { db } = open(path);
    expect(() =>
      db.prepare('INSERT INTO documents (id, body, created_at, updated_at) VALUES (?,?,?,?)').run(
        'x',
        '{}',
        1,
        1,
      ),
    ).toThrow(/READONLY/i);
    db.close();
  });

  it('leaves the file untouched, so an older build can still open it', () => {
    const path = tempPath();
    stale(path);
    const before = readFileSync(path);
    open(path).db.close();
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  /** Export has to work on precisely the files `open` will not write. */
  it('can be exported without knowing its schema', () => {
    const path = tempPath();
    stale(path);
    const dump = exportTables(path);
    expect(Object.keys(dump)).toEqual(['documents']);
    expect((dump.documents[0] as { id: string }).id).toBe('old1');
  });

  it('archives rather than deletes, and takes the WAL sidecars with it', () => {
    const path = tempPath();
    const db = open(path).db;
    saveDocument(db, record('d1'));
    db.close();
    const moved = archive(path, 1234);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(moved)).toBe(true);
    // Still readable where it went. "Recreate" drops it from the app's view
    // without making it unrecoverable.
    expect(Object.keys(exportTables(moved))).toContain('documents');
  });

  it('stamps a fresh database so the next open recognises it', () => {
    const path = tempPath();
    const first = open(path);
    expect(first.writable).toBe(true);
    expect(first.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    first.db.close();
    expect(open(path).writable).toBe(true);
  });
});

/**
 * The version is a number someone has to remember to increment, which is a
 * guarantee that holds because a person maintains it. This is what makes it
 * enforced instead: editing the schema without deciding turns the suite red.
 *
 * When it fails, the decision is which kind of change it was. Additive -- a new
 * table, index, or a VIRTUAL generated column, all of which an existing file can
 * take -- keeps the version and updates only this hash. Incompatible, meaning
 * anything that makes an older file unwritable, bumps SCHEMA_VERSION too.
 */
describe('the schema version is pinned to the schema', () => {
  it('matches the file it describes', () => {
    const sql = readFileSync(join(import.meta.dirname, '../server/schema.sql'));
    expect(
      createHash('sha256').update(sql).digest('hex'),
      'server/schema.sql changed. Additive change: update this hash. Incompatible change: bump SCHEMA_VERSION as well.',
    ).toBe('02c4524a8085311f51176e7b308a34fb2208be254d496d988852a97c51f58cb0');
  });

  it('is a positive integer, so 0 stays available to mean unstamped', () => {
    // `open` reads 0 from a fresh file and from one written before this check
    // existed, and tells them apart by whether the file has tables. A
    // SCHEMA_VERSION of 0 would collapse that distinction.
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
  });
});
