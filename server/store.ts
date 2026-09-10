/**
 * SQLite storage.
 *
 * Server-side only, and deliberately outside `src/` so that vite never bundles
 * it and no client import can reach a native module by accident. The browser
 * talks to this over HTTP; it does not talk to SQLite.
 *
 * The function shapes mirror `src/db/db.ts` on purpose. That file is the seam
 * the app already reads and writes through, so keeping the signatures means the
 * swap from IndexedDB is a change of transport rather than a change of app code.
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { describeSchemaFailure } from '../src/core/ir/schema';
import type { H3Document } from '../src/core/ir/types';
import type { Task } from '../src/provider/types';

export interface StoredDocument {
  id: string;
  title: string;
  /** The expanded idea that produced it. See the column comment in schema.sql. */
  idea: string;
  updatedAt: number;
  doc: H3Document;
  headVersionId: string;
}

export interface StoredVersion {
  id: string;
  documentId: string;
  parentId: string | null;
  rootId: string;
  createdAt: number;
  label: string;
  doc: H3Document;
  operations: { path: string; before: unknown; after: unknown; rationale: string }[];
}

/** The stage a call reached. The conformance harness's vocabulary, not a new one. */
export type RunStage =
  | 'provider'
  | 'no_json'
  | 'truncated'
  | 'schema'
  | 'assembly'
  | 'diagnostics'
  | 'clean';

export interface RunRecord {
  id: string;
  createdAt: number;
  documentId?: string | null;
  versionId?: string | null;
  armId?: string | null;
  /**
   * Which role made the call, typed to the provider seam's own `Task` union
   * rather than a string.
   *
   * `CallOptions.task` already names these and both `pipeline.ts` call sites
   * already pass them, so this is the existing enumeration rather than a second
   * one. That matters for the binding rows: a binding for a role nothing records
   * and a run under a role nothing binds both look fine locally, and the drift is
   * invisible from either side, so the two have to resolve from one place. When
   * the analysis roles join the seam, `Task` widens and this follows for free.
   *
   * Deliberately NOT a CHECK constraint in SQL: that would be a second copy of
   * the union, in a place `tsc` cannot see, drifting the moment `Task` widens.
   */
  role: Task;
  provider: string;
  model: string;
  instanceId?: string | null;
  task?: string | null;
  thinking?: 'auto' | 'on' | 'off' | null;
  effort?: string | null;
  enforceSchema?: boolean | null;
  creativeMode?: string | null;
  stage: RunStage;
  failureCause?: string | null;
  readerNote?: string | null;
  durationMs?: number | null;
  attempts?: number;
  queuedMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  promptSha256?: string | null;
  rawOutput?: string | null;
  appVersion?: string | null;
  contractJsonSha?: string | null;
}

export type Db = Database.Database;

/**
 * A handle this build may write.
 *
 * Branded so `tsc` rejects handing a read-only database to a writer, rather
 * than leaving it to SQLITE_READONLY at the moment of the insert -- which would
 * be an error far from its cause, the exact failure mode the lineage check
 * exists to remove, reintroduced one level up. Same move as `WritableKeyMode`
 * in `src/crypto/secureStore.ts`, which excludes the decrypt-only mode so a
 * write fails to compile instead of failing at runtime.
 *
 * The brand is applied in exactly one place: `open`, after the version matched.
 */
declare const writable: unique symbol;
export type WritableDb = Db & { readonly [writable]: true };

/**
 * The shape this build writes. Bump it whenever a column changes meaning, type
 * or generated-ness -- not when a table is merely added, which `IF NOT EXISTS`
 * already handles.
 */
export const SCHEMA_VERSION = 2;

/** What a lineage mismatch is, when there is one. */
export interface SchemaMismatch {
  path: string;
  found: number;
  expected: number;
  /** Ready to show. The recovery is the caller's choice, so this states them. */
  message: string;
}

/**
 * Discriminated on `writable`, so narrowing it is what produces a handle the
 * write functions accept. A caller cannot reach `WritableDb` without checking.
 */
export type Opened =
  | { db: WritableDb; writable: true; mismatch: null }
  | { db: Db; writable: false; mismatch: SchemaMismatch };

/** Tables the file actually has, so detection depends on no particular one. */
function tableNames(db: Db): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

/**
 * Open a database, read-only if this build cannot write its shape.
 *
 * `CREATE TABLE IF NOT EXISTS` grows a schema and cannot change one: a table
 * that already exists is skipped whatever its columns say. That was silent until
 * this check existed -- a file written by an older build opened successfully and
 * then threw `cannot INSERT into generated column` at an unrelated call site.
 *
 * It reports rather than gates, which is the same shape `loadDocument` already
 * has one level down, and it is what lets two rules that look opposed both hold.
 * "A build that refuses to open what the previous build wrote loses work that
 * exists nowhere else" is about CONTENTS: every document here stays readable.
 * `src/db/db.ts`'s "no data migrations, deliberately" is about the CONTAINER:
 * nothing is rewritten, so no migration code exists to be half-written. Refusing
 * outright would have honoured the second and broken the first; read-only
 * honours both, and makes `exportTables` available on exactly the files that
 * need it.
 *
 * `foreign_keys` is set here rather than in the schema file because it is a
 * per-connection pragma that SQLite defaults OFF: a connection that skipped it
 * would accept orphan rows silently.
 */
export function open(path: string): Opened {
  const probe = new Database(path);
  const found = (probe.pragma('user_version', { simple: true }) as number) ?? 0;
  const populated = tableNames(probe).length > 0;

  // A fresh file reads 0 and has no tables. A file from before this check
  // existed also reads 0 but HAS tables, and is exactly the case that used to
  // fail at write time -- so it is a mismatch rather than something to stamp.
  const compatible = found === SCHEMA_VERSION || (found === 0 && !populated);
  if (!compatible) {
    probe.close();
    const db = new Database(path, { readonly: true });
    return {
      db,
      writable: false,
      mismatch: {
        path,
        found,
        expected: SCHEMA_VERSION,
        message:
          `The database at ${path} was written by schema version ${found}; this build writes ` +
          `${SCHEMA_VERSION}. It is open read-only and has not been modified. You can export it ` +
          `to files, recreate it (which moves this file aside and starts empty, so the app will ` +
          `no longer show these documents), or stop and open it with the build that wrote it.`,
      },
    };
  }

  probe.pragma('journal_mode = WAL');
  probe.pragma('foreign_keys = ON');
  probe.exec(readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8'));
  probe.pragma(`user_version = ${SCHEMA_VERSION}`);
  return { db: probe as WritableDb, writable: true, mismatch: null };
}

/**
 * The writable handle, or a throw naming why there is not one.
 *
 * For the callers that genuinely cannot proceed read-only -- the server at
 * startup. It throws rather than returning a union so that "I require a writable
 * database" is stated once, at the point that requires it, instead of every
 * write site re-deciding. Anything that can degrade gracefully should narrow
 * `Opened` itself and offer the recoveries in `mismatch.message`.
 */
export function mustWrite(opened: Opened): WritableDb {
  if (!opened.writable) throw new Error(opened.mismatch.message);
  return opened.db;
}

/**
 * Every row of every table, as plain JSON, without knowing the schema.
 *
 * `SELECT *` needs no agreement about columns, which is the whole point: this
 * has to work on precisely the databases `open` refuses. Returned rather than
 * written so the caller decides where it goes and nothing here touches the file
 * system beyond reading.
 */
export function exportTables(path: string): Record<string, unknown[]> {
  const db = new Database(path, { readonly: true });
  try {
    const out: Record<string, unknown[]> = {};
    for (const name of tableNames(db)) {
      // Not `SELECT *`: that includes generated columns, and a dump carrying
      // them cannot be read back -- the insert fails with `cannot INSERT into
      // generated column`, which is the same sentence a stale file throws at
      // saveDocument, one layer further out. Export is the migration mechanism
      // here, so a dump that does not round-trip removes the load-bearing half
      // of the read-only answer, and nothing would notice until the moment
      // someone actually needed it.
      //
      // `hidden` is 0 for an ordinary column, 2 for VIRTUAL and 3 for STORED,
      // so ordinary columns are the ones to take. `table_info` cannot be used
      // for this: it omits generated columns of both kinds rather than marking
      // them, so it cannot tell you what to leave out.
      //
      // Derived per table at read time rather than from this build's schema,
      // because the files this runs on are by definition written by a different
      // one and may generate different columns.
      const cols = (
        db.prepare(`SELECT name, hidden FROM pragma_table_xinfo(?)`).all(name) as {
          name: string;
          hidden: number;
        }[]
      )
        .filter((c) => c.hidden === 0)
        .map((c) => `"${c.name}"`);
      out[name] = db.prepare(`SELECT ${cols.join(', ')} FROM "${name}"`).all();
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Move a database aside and return where it went.
 *
 * Renames rather than deletes. The user asked to drop the data, not to make it
 * unrecoverable, and the difference costs one `rename` -- so "recreate" is
 * honest about losing the documents from the app's view while leaving the bytes
 * on disk for anyone who later wishes it had not.
 *
 * The WAL and shared-memory sidecars go too. Leaving them beside a fresh
 * database of the same name is how a stale write log gets replayed into it.
 */
export function archive(path: string, now = Date.now()): string {
  const target = `${path}.superseded-${now}`;
  renameSync(path, target);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(path + suffix)) renameSync(path + suffix, target + suffix);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function saveDocument(db: WritableDb, record: StoredDocument): void {
  const now = record.updatedAt;
  db.prepare(
    `INSERT INTO documents (id, title, idea, body, created_at, updated_at, head_version_id)
     VALUES (@id, @title, @idea, @body, @now, @now, @head)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       idea = excluded.idea,
       body = excluded.body,
       updated_at = excluded.updated_at,
       head_version_id = excluded.head_version_id`,
  ).run({
    id: record.id,
    title: record.title,
    idea: record.idea ?? '',
    body: JSON.stringify(record.doc),
    now,
    head: record.headVersionId,
  });
}

/**
 * Read a document and say whether it still matches the current schema.
 *
 * The check reports; it does not gate. A document that fails to parse is still
 * returned, because the alternative is a build that silently refuses to open
 * work the previous build wrote. This is the property `test/db.test.ts` pairs
 * as "it is reported" and "it still opened", and it is the specific reason the
 * body is one JSON column rather than shredded into tables: relational columns
 * would turn this warning into an insert failure.
 */
export function loadDocument(
  db: Db,
  id: string,
): { record: StoredDocument; schemaError: string | null } | undefined {
  // `SELECT *` rather than a column list, and it is load-bearing rather than
  // lazy. This has to work on a database written by a DIFFERENT schema, which is
  // the whole promise of read-only mode -- and a named column list breaks the
  // moment this build knows a column the file does not, which is exactly what
  // adding `idea` did. A test caught it: "serves reads" went red on a stale
  // fixture. Same class as the export round-trip bug, one direction over: the
  // recovery path has to work on precisely the state that needs it.
  //
  // Every field is then read defensively, because on such a file any of them may
  // be absent.
  const row = db
    .prepare(`SELECT * FROM documents WHERE id = ? AND deleted_at IS NULL`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;

  const doc = JSON.parse(String(row.body)) as H3Document;
  return {
    record: {
      id: String(row.id),
      title: (row.title as string | null) ?? '',
      idea: (row.idea as string | null) ?? '',
      updatedAt: Number(row.updated_at),
      doc,
      headVersionId: (row.head_version_id as string | null) ?? '',
    },
    schemaError: describeSchemaFailure(doc),
  };
}

export function listDocuments(db: Db, limit = 200): StoredDocument[] {
  // `SELECT *` for the same reason as `loadDocument`: this must survive a file
  // whose columns differ from this build's.
  const rows = db
    .prepare(
      `SELECT * FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: (r.title as string | null) ?? '',
    idea: (r.idea as string | null) ?? '',
    updatedAt: Number(r.updated_at),
    doc: JSON.parse(String(r.body)) as H3Document,
    headVersionId: (r.head_version_id as string | null) ?? '',
  }));
}

/** Soft delete. The erase button hard-deletes; this is the undoable one. */
export function deleteDocument(db: WritableDb, id: string, at: number): void {
  db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(at, id);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function saveVersion(db: WritableDb, v: StoredVersion): void {
  db.prepare(
    `INSERT INTO versions (id, document_id, parent_id, root_id, created_at, label, body, operations)
     VALUES (@id, @documentId, @parentId, @rootId, @createdAt, @label, @body, @operations)`,
  ).run({
    id: v.id,
    documentId: v.documentId,
    parentId: v.parentId,
    rootId: v.rootId,
    createdAt: v.createdAt,
    label: v.label,
    body: JSON.stringify(v.doc),
    operations: JSON.stringify(v.operations),
  });
}

/**
 * Allocate an id and write the version, in ONE transaction.
 *
 * The allocation moved here from the browser with the store. Reading the
 * highest id and then inserting in a separate step is a read-then-write race,
 * and it was reachable: two edits could resolve the same highest id and the
 * second write would destroy the first version row. IndexedDB serialised that
 * inside a readwrite transaction; SQLite does the same inside `transaction`,
 * and the server is now the only writer, which is a stronger guarantee than
 * the browser could give.
 *
 * `rootId` is derived rather than supplied: a version with no parent roots its
 * own tree, and any other inherits its parent's. Passing it in would let a
 * caller create a version whose root disagrees with its ancestry.
 */
export function recordVersion(
  db: WritableDb,
  params: {
    documentId: string;
    parentId: string | null;
    label: string;
    doc: H3Document;
    operations?: StoredVersion['operations'];
  },
): StoredVersion {
  return db.transaction(() => {
    const prefix = `${params.documentId}:v`;
    const rows = db
      .prepare('SELECT id FROM versions WHERE document_id = ?')
      .all(params.documentId) as { id: string }[];
    // A suffix this build did not write is skipped rather than guessed at, so
    // an id from a future scheme cannot drag the sequence backwards.
    const highest = rows.reduce((max, r) => {
      if (!r.id.startsWith(prefix)) return max;
      const n = Number.parseInt(r.id.slice(prefix.length), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    const id = `${prefix}${String(highest + 1).padStart(4, '0')}`;
    const parentRoot = params.parentId
      ? (
          db.prepare('SELECT root_id FROM versions WHERE id = ?').get(params.parentId) as
            | { root_id: string }
            | undefined
        )?.root_id
      : undefined;

    // Ensure the parent document exists to satisfy foreign key constraint on versions.document_id.
    // When a document is first generated, the client allocates a version id before saving
    // the document row with headVersionId.
    const docExists = db.prepare('SELECT 1 FROM documents WHERE id = ?').get(params.documentId);
    if (!docExists) {
      saveDocument(db, {
        id: params.documentId,
        title: params.label,
        idea: '',
        updatedAt: Date.now(),
        doc: params.doc,
        headVersionId: id,
      });
    }

    const version: StoredVersion = {
      id,
      documentId: params.documentId,
      parentId: params.parentId,
      rootId: parentRoot ?? id,
      createdAt: Date.now(),
      label: params.label,
      doc: params.doc,
      operations: params.operations ?? [],
    };
    saveVersion(db, version);
    return version;
  })();
}

/**
 * Every version of a document, oldest first.
 *
 * The id breaks the tie on `created_at`, and the tie is reachable: two versions
 * recorded in the same millisecond compare equal, and the order then falls out
 * of storage rather than out of the sequence they were allocated in. Ids are
 * zero-padded, so they sort in allocation order.
 */
export function listVersions(db: Db, documentId: string): StoredVersion[] {
  const rows = db
    .prepare(
      `SELECT id, document_id, parent_id, root_id, created_at, label, body, operations
         FROM versions WHERE document_id = ?
         ORDER BY created_at ASC, id ASC`,
    )
    .all(documentId) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    id: r.id as string,
    documentId: r.document_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    rootId: r.root_id as string,
    createdAt: r.created_at as number,
    label: r.label as string,
    doc: JSON.parse(r.body as string) as H3Document,
    operations: JSON.parse(r.operations as string),
  }));
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Whether prompts are kept. Default on; the setting is how you say otherwise.
 *
 * Read at WRITE time rather than swept up later, because retention is a
 * standing preference and erasing is an action: someone who does not want
 * prompts on disk should not have to remember to act. A cleanup job would also
 * be a second place the policy lives, and the two would drift.
 *
 * Enforced here rather than at the caller so it holds for every caller,
 * including one that forgets. A client cannot opt itself back in.
 */
export const RETAIN_RAW_OUTPUT_SETTING = 'retainRawOutput';

export function recordRun(db: WritableDb, run: RunRecord): void {
  const retain = getSetting(db, RETAIN_RAW_OUTPUT_SETTING, true);
  db.prepare(
    `INSERT INTO runs (
       id, created_at, document_id, version_id, arm_id, role, provider, model,
       instance_id, task, thinking, effort, enforce_schema, creative_mode, stage,
       failure_cause, reader_note, duration_ms, attempts, queued_ms,
       prompt_tokens, output_tokens, prompt_sha256, raw_output,
       app_version, contract_json_sha)
     VALUES (
       @id, @createdAt, @documentId, @versionId, @armId, @role, @provider, @model,
       @instanceId, @task, @thinking, @effort, @enforceSchema, @creativeMode, @stage,
       @failureCause, @readerNote, @durationMs, @attempts, @queuedMs,
       @promptTokens, @outputTokens, @promptSha256, @rawOutput,
       @appVersion, @contractJsonSha)`,
  ).run({
    ...run,
    documentId: run.documentId ?? null,
    versionId: run.versionId ?? null,
    armId: run.armId ?? null,
    instanceId: run.instanceId ?? null,
    task: run.task ?? null,
    thinking: run.thinking ?? null,
    effort: run.effort ?? null,
    enforceSchema: run.enforceSchema == null ? null : run.enforceSchema ? 1 : 0,
    creativeMode: run.creativeMode ?? null,
    failureCause: run.failureCause ?? null,
    readerNote: run.readerNote ?? null,
    durationMs: run.durationMs ?? null,
    attempts: run.attempts ?? 1,
    queuedMs: run.queuedMs ?? null,
    promptTokens: run.promptTokens ?? null,
    outputTokens: run.outputTokens ?? null,
    promptSha256: run.promptSha256 ?? null,
    // Dropped rather than truncated: a partial prompt is not evidence of
    // anything and would still be prompt text on disk.
    rawOutput: retain ? (run.rawOutput ?? null) : null,
    appVersion: run.appVersion ?? null,
    contractJsonSha: run.contractJsonSha ?? null,
  });
}

// ---------------------------------------------------------------------------
// Erasing
// ---------------------------------------------------------------------------

/**
 * The tables the erase button surveys and clears.
 *
 * `runs` is on this list and it is the one that matters most: `raw_output`
 * holds prompt text, so a survey that skipped it would let the button report a
 * clean erase while every prompt sat on disk. The experiments and arms around
 * it go too, since an arm whose runs are gone measures nothing.
 */
export const ERASABLE = ['documents', 'versions', 'settings', 'runs', 'arms', 'experiments'] as const;
export type ErasableTable = (typeof ERASABLE)[number];

/** Row counts per table, read from storage rather than assumed. */
export function surveyCounts(db: Db): Record<ErasableTable, number> {
  const out = {} as Record<ErasableTable, number>;
  for (const table of ERASABLE) {
    out[table] = (db.prepare(`SELECT count(*) n FROM "${table}"`).get() as { n: number }).n;
  }
  return out;
}

/**
 * Delete everything, then RE-READ the counts.
 *
 * The returned `after` is what storage says, not what the code did. That is the
 * property the IndexedDB version had and the one most at risk of being lost
 * across a process boundary, where it is tempting to answer "the statement ran"
 * instead. A caller can then report "could not verify" honestly.
 *
 * Order matters: children before parents, because foreign keys are on.
 */
export function eraseAll(db: WritableDb): {
  before: Record<ErasableTable, number>;
  after: Record<ErasableTable, number>;
} {
  const before = surveyCounts(db);
  db.transaction(() => {
    for (const table of ERASABLE) db.prepare(`DELETE FROM "${table}"`).run();
  })();
  return { before, after: surveyCounts(db) };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function setSetting(db: WritableDb, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}
