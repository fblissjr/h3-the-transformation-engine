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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { H3DocumentSchema } from '../src/core/ir/schema';
import type { H3Document } from '../src/core/ir/types';

export interface StoredDocument {
  id: string;
  title: string;
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
  role: string;
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
 * Open a database and bring it up to the schema.
 *
 * Every statement is `IF NOT EXISTS`, so this is both the create path and the
 * repair path and it is never a reset -- the same property `src/db/db.ts` holds
 * for IndexedDB, where a build that refused to open what the previous one wrote
 * would lose work that exists nowhere else.
 *
 * `foreign_keys` is set here rather than in the schema file because it is a
 * per-connection pragma that SQLite defaults OFF: a connection that skipped it
 * would accept orphan rows silently.
 */
export function open(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(import.meta.dirname, 'schema.sql'), 'utf8'));
  return db;
}

/** The first schema complaint about a stored document, or null if it parses. */
export function describeSchemaFailure(doc: unknown): string | null {
  const parsed = H3DocumentSchema.safeParse(doc);
  if (parsed.success) return null;
  const first = parsed.error.issues[0];
  const where = first.path.length > 0 ? first.path.join('.') : 'the document';
  return `${where}: ${first.message}`;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function saveDocument(db: Db, record: StoredDocument): void {
  const now = record.updatedAt;
  db.prepare(
    `INSERT INTO documents (id, title, body, created_at, updated_at, head_version_id)
     VALUES (@id, @title, @body, @now, @now, @head)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       updated_at = excluded.updated_at,
       head_version_id = excluded.head_version_id`,
  ).run({
    id: record.id,
    title: record.title,
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
  const row = db
    .prepare(
      `SELECT id, body, updated_at, head_version_id, title
         FROM documents WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as
    | { id: string; body: string; updated_at: number; head_version_id: string | null; title: string | null }
    | undefined;
  if (!row) return undefined;

  const doc = JSON.parse(row.body) as H3Document;
  return {
    record: {
      id: row.id,
      title: row.title ?? '',
      updatedAt: row.updated_at,
      doc,
      headVersionId: row.head_version_id ?? '',
    },
    schemaError: describeSchemaFailure(doc),
  };
}

export function listDocuments(db: Db, limit = 200): StoredDocument[] {
  const rows = db
    .prepare(
      `SELECT id, body, updated_at, head_version_id, title
         FROM documents WHERE deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    body: string;
    updated_at: number;
    head_version_id: string | null;
    title: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? '',
    updatedAt: r.updated_at,
    doc: JSON.parse(r.body) as H3Document,
    headVersionId: r.head_version_id ?? '',
  }));
}

/** Soft delete. The erase button hard-deletes; this is the undoable one. */
export function deleteDocument(db: Db, id: string, at: number): void {
  db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(at, id);
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function saveVersion(db: Db, v: StoredVersion): void {
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

export function listVersions(db: Db, documentId: string): StoredVersion[] {
  const rows = db
    .prepare(
      `SELECT id, document_id, parent_id, root_id, created_at, label, body, operations
         FROM versions WHERE document_id = ? ORDER BY created_at DESC`,
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

export function recordRun(db: Db, run: RunRecord): void {
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
    rawOutput: run.rawOutput ?? null,
    appVersion: run.appVersion ?? null,
    contractJsonSha: run.contractJsonSha ?? null,
  });
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

export function setSetting(db: Db, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}
