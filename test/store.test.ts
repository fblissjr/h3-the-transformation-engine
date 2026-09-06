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
  mustWrite,
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

const record = (
  id: string,
  doc: unknown = t2vaBaker,
  title = `title of ${id}`,
  idea = `idea behind ${id}`,
) => ({
  id,
  title,
  idea,
  updatedAt: 1_700_000_000_000,
  doc: doc as never,
  headVersionId: `v_${id}`,
});

describe('documents round-trip', () => {
  it('returns the document that was stored', () => {
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1'));
    expect(loadDocument(db, 'd1')?.record.doc).toEqual(t2vaBaker);
  });

  it('derives mode and shot count from the body rather than storing them twice', () => {
    const db = mustWrite(open(':memory:'));
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
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1', t2vaBaker, 'Bakery at dawn'));
    expect(loadDocument(db, 'd1')!.record.title).toBe('Bakery at dawn');
    expect(listDocuments(db)[0].title).toBe('Bakery at dawn');
    // The body genuinely has no title, which is why deriving one was wrong.
    expect((t2vaBaker as { title?: string }).title).toBeUndefined();
  });

  it('keeps the title across a re-save of the same document', () => {
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1', t2vaBaker, 'first name'));
    saveDocument(db, record('d1', t2vaBaker, 'renamed'));
    expect(loadDocument(db, 'd1')!.record.title).toBe('renamed');
  });

  it('omits soft-deleted documents from the list and from load', () => {
    const db = mustWrite(open(':memory:'));
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
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1', { schemaVersion: '1.0.0', id: 'd1', mode: 'NOT_A_MODE' }));
    const got = loadDocument(db, 'd1');
    expect(got, 'the record still came back').toBeDefined();
    expect(got!.schemaError, 'and the failure was reported').not.toBeNull();
    expect(got!.record.doc).toMatchObject({ mode: 'NOT_A_MODE' });
  });

  it('reports nothing for a document that parses', () => {
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1'));
    expect(loadDocument(db, 'd1')!.schemaError).toBeNull();
  });
});

describe('opening an existing database', () => {
  /** Repair must never be a disguised reset. */
  it('keeps the rows that were already there', () => {
    const path = tempPath();
    const first = mustWrite(open(path));
    saveDocument(first, record('d1'));
    setSetting(first, 'provider', 'heylook');
    first.close();

    const second = mustWrite(open(path));
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
    const db = mustWrite(open(':memory:'));
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
    const db = mustWrite(open(':memory:'));
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
    const db = mustWrite(open(':memory:'));
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
    const db = mustWrite(open(path));
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
    ).toBe('ab7c8f28a8740fb8daabf786ebe235e7a9548215a96807e2408a28729379ae28');
  });

  /**
   * The first real exercise of the mechanism. Adding `idea` is INCOMPATIBLE
   * rather than additive: `CREATE TABLE IF NOT EXISTS` skips a table that
   * already exists, so an older file would keep a `documents` with no `idea`
   * column and every write naming it would fail. Additive would have meant a new
   * table or index, or a VIRTUAL generated column, which an existing file can
   * take.
   */
  it('was bumped for the idea column, which an existing file could not have taken', () => {
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('is a positive integer, so 0 stays available to mean unstamped', () => {
    // `open` reads 0 from a fresh file and from one written before this check
    // existed, and tells them apart by whether the file has tables. A
    // SCHEMA_VERSION of 0 would collapse that distinction.
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
  });
});

/**
 * Export is the migration mechanism, not a convenience.
 *
 * The read-only answer to a lineage mismatch rests entirely on "you can always
 * get your rows out and back in", so an export that does not round-trip removes
 * the load-bearing half of it -- and nothing would notice until the moment
 * someone actually needed it, which is the worst possible time to find out.
 *
 * The first version of `exportTables` used `SELECT *`, which includes generated
 * columns, so a dump of `documents` carried `mode` and `shot_count` and reading
 * it back failed with `cannot INSERT into generated column`. That is the same
 * sentence a stale file throws at `saveDocument`, one layer further out.
 */
describe('an export can be read back in', () => {
  const reimport = (dump: Record<string, unknown[]>, into: string) => {
    const db = mustWrite(open(into));
    for (const [table, rows] of Object.entries(dump)) {
      for (const row of rows as Record<string, unknown>[]) {
        const cols = Object.keys(row);
        db.prepare(
          `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) ` +
            `VALUES (${cols.map(() => '?').join(',')})`,
        ).run(...cols.map((c) => row[c]));
      }
    }
    return db;
  };

  it('round-trips a document into a fresh database', () => {
    const from = tempPath();
    const source = mustWrite(open(from));
    saveDocument(source, record('d1', t2vaBaker, 'Bakery at dawn'));
    source.close();

    const restored = reimport(exportTables(from), tempPath());
    const got = loadDocument(restored, 'd1');
    expect(got!.record.title).toBe('Bakery at dawn');
    expect(got!.record.doc).toEqual(t2vaBaker);
    // And the generated columns recompute on the way in rather than being
    // carried across, which is why they must not be exported.
    expect(
      restored.prepare('SELECT mode, shot_count FROM documents WHERE id = ?').get('d1'),
    ).toEqual({ mode: t2vaBaker.mode, shot_count: t2vaBaker.shots.length });
  });

  it('omits generated columns, which is what makes that possible', () => {
    const path = tempPath();
    const db = mustWrite(open(path));
    saveDocument(db, record('d1'));
    db.close();
    const keys = Object.keys(exportTables(path).documents[0] as object);
    expect(keys).toContain('body');
    expect(keys).not.toContain('mode');
    expect(keys).not.toContain('shot_count');
    // `title` is stored, not generated, so it must survive.
    expect(keys).toContain('title');
  });
});

/**
 * The originating idea, which nothing persisted before this.
 *
 * A document could not be regenerated: `doc.roll` holds the template and seed
 * and only when wildcards were used, so a plainly typed idea left nothing
 * behind. `types.ts` names the gap in its own `roll` comment -- "the template it
 * was a seed of lives in the idea box, which nothing persists".
 */
describe('the idea that produced a document', () => {
  it('round-trips, and survives a re-save', () => {
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1', t2vaBaker, 'T', 'a baker at dawn, rain outside'));
    expect(loadDocument(db, 'd1')!.record.idea).toBe('a baker at dawn, rain outside');
    saveDocument(db, record('d1', t2vaBaker, 'T', 'a baker at dusk'));
    expect(loadDocument(db, 'd1')!.record.idea).toBe('a baker at dusk');
  });

  it('is on the list rows too, so a library view can show it', () => {
    const db = mustWrite(open(':memory:'));
    saveDocument(db, record('d1', t2vaBaker, 'T', 'the idea'));
    expect(listDocuments(db)[0].idea).toBe('the idea');
  });

  /**
   * The column defaults rather than requiring, so a caller that predates it --
   * an HTTP body parsed as `unknown`, for instance -- still stores. The TYPE
   * requires it, which is what makes new app code state it deliberately.
   */
  it('defaults to empty for a caller that omits it', () => {
    const db = mustWrite(open(':memory:'));
    const { idea: _dropped, ...without } = record('d1');
    saveDocument(db, without as never);
    expect(loadDocument(db, 'd1')!.record.idea).toBe('');
  });
});
