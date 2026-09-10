/**
 * Storage, over HTTP.
 *
 * The documents, versions and settings live in SQLite on the bun server; this
 * is the client half. It replaced an IndexedDB layer, and every signature is
 * unchanged because they were already async -- the swap is a change of
 * transport, not of shape, which is what kept it out of the call sites.
 *
 * What did NOT move: `src/crypto/secureStore.ts`. That holds the Gemini API
 * key, and with no proxy the browser calls Gemini directly, so the key has to
 * be in the browser. Sending it to the server would put it on disk there for no
 * benefit. So "IndexedDB was removed" is true of the document store and false
 * of the vault, and the two have different reasons to exist.
 *
 * Same origin in both modes: bun serves the built SPA in production and vite
 * proxies `/api` in dev. That is what lets `connect-src 'self'` cover this with
 * no policy entry -- a cross-origin call here would be refused before it left
 * the page, with no status and no body.
 */

import type { H3Document } from '../core/ir/types';
import { trace } from '../debug';
import { describeSchemaFailure } from '../core/ir/schema';

export interface StoredDocument {
  id: string;
  title: string;
  /**
   * The expanded idea that produced it, so a document can be regenerated.
   *
   * `doc.roll` is not a substitute: it holds the template and seed, and only
   * when wildcards were used, so a plainly typed idea left nothing behind.
   */
  idea: string;
  updatedAt: number;
  doc: H3Document;
  /** Version currently checked out, so a reload lands where the user left off. */
  headVersionId: string;
}

export interface StoredVersion {
  id: string;
  documentId: string;
  parentId: string | null;
  /** Alongside parentId, so "every version of this document" is not a walk. */
  rootId: string;
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

/**
 * A write refused because the database was written by another schema.
 *
 * Carries the server's message rather than a generic failure, because the
 * message names the three recoveries. The UI can then say what happened instead
 * of "save failed", which is the whole reason the server answers 409 rather
 * than 500 -- a well-formed request that the state prevents is a different
 * thing from a broken server.
 */
export class SchemaMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMismatchError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new SchemaMismatchError(body.message ?? 'This database cannot be written by this build.');
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`${init?.method ?? 'GET'} /api${path} failed: ${res.status}`);
  }
  return (res.status === 404 ? undefined : await res.json()) as T;
}

/** Whether this build can write the database, and why not when it cannot. */
export async function storageStatus(): Promise<{
  writable: boolean;
  mismatch: { message: string } | null;
}> {
  return call('/status');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function saveDocument(record: StoredDocument): Promise<void> {
  await call(`/documents/${encodeURIComponent(record.id)}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
  // Read defensively, and not for the sake of it: this threw on the partial
  // records the storage tests store on purpose, and took `saveDocument` down
  // with it. A trace that can break its subject is worse than no trace.
  trace('storage', 'storage.saveDocument', `saved "${record.title}"`, {
    id: record.id,
    title: record.title,
    headVersionId: record.headVersionId,
    mode: record.doc?.mode ?? null,
    shots: record.doc?.shots?.length ?? null,
  });
}

/**
 * Read a stored document and say whether it still matches the current schema.
 *
 * The check reports; it does not gate. A document that fails to parse is still
 * returned, because the alternative is a build that silently refuses to open
 * work the previous build wrote, and there is no copy of it anywhere else.
 *
 * `schemaError` is recomputed here rather than trusted from the wire. The
 * server computes it too, but the client is the build whose schema actually
 * matters to the UI about to render it.
 */
export async function loadDocument(
  id: string,
): Promise<{ record: StoredDocument; schemaError: string | null } | undefined> {
  const found = await call<{ record: StoredDocument } | undefined>(
    `/documents/${encodeURIComponent(id)}`,
  );
  if (!found) {
    trace('storage', 'storage.loadDocument', `no stored document under "${id}"`, { id, found: false });
    return undefined;
  }
  const { record } = found;
  const schemaError = describeSchemaFailure(record.doc);
  trace(
    'storage',
    'storage.loadDocument',
    schemaError == null
      ? `loaded "${record.title}"`
      : `loaded "${record.title}", which does not match the current schema: ${schemaError}`,
    { id, found: true, title: record.title, headVersionId: record.headVersionId, schemaError },
    { level: schemaError == null ? 'info' : 'warn' },
  );
  return { record, schemaError };
}

export async function listDocuments(): Promise<StoredDocument[]> {
  return call('/documents');
}

export async function deleteDocument(id: string): Promise<void> {
  await call(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  trace('storage', 'storage.deleteDocument', `deleted "${id}" and its versions`, { id });
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/**
 * Record one call.
 *
 * Fire-and-forget on purpose: a measurement that could fail a generation would
 * be a trace that breaks the thing it traces, which is the rule `src/debug/`
 * already holds. A lost row is a gap in the data; a thrown one is a lost
 * document.
 */
export interface RunTelemetryPayload extends Record<string, unknown> {
  model: string;
}

export async function recordRun(run: RunTelemetryPayload): Promise<void> {
  try {
    await call('/runs', { method: 'POST', body: JSON.stringify(run) });
  } catch (error) {
    trace(
      'storage',
      'storage.recordRun',
      `run not recorded: ${error instanceof Error ? error.message : String(error)}`,
      { id: run.id ?? null },
      { level: 'warn' },
    );
  }
}

// ---------------------------------------------------------------------------
// Erasing
// ---------------------------------------------------------------------------

/** The tables the server surveys. Named by the server, not duplicated here. */
export type ServerTable = string;

export async function surveyServer(): Promise<Record<ServerTable, number>> {
  return call('/survey');
}

/**
 * Erase server-side storage and return what it looked like afterwards.
 *
 * The server re-reads its counts rather than reporting that the delete ran, and
 * answers 200 with those counts even when rows survive. Only a transport
 * failure throws, which is what keeps "could not verify" distinguishable from
 * "erased".
 */
export async function eraseServer(): Promise<{
  before: Record<ServerTable, number>;
  after: Record<ServerTable, number>;
}> {
  return call('/erase', { method: 'POST', body: JSON.stringify({}) });
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** Every version of a document, oldest first, as the tree builders expect. */
export async function fetchVersions(documentId: string): Promise<StoredVersion[]> {
  return call(`/documents/${encodeURIComponent(documentId)}/versions`);
}

/**
 * Write a version and get back what the server allocated.
 *
 * The id and `rootId` are the server's to decide, so neither is sent: the id
 * because allocating it here would reintroduce the read-then-write race the
 * transaction exists to prevent, and `rootId` because a caller could otherwise
 * write one that disagrees with its own ancestry.
 */
export async function postVersion(
  documentId: string,
  body: Omit<StoredVersion, 'id' | 'documentId' | 'rootId' | 'createdAt'>,
): Promise<StoredVersion> {
  return call(`/documents/${encodeURIComponent(documentId)}/versions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await call<{ value: T | null } | undefined>(`/settings/${encodeURIComponent(key)}`);
  return row && row.value !== null ? row.value : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await call(`/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
  // `key` here is a setting name -- `provider`, `heylookModel` -- and it is
  // deliberately not one of the field names `src/debug/redact.ts` blanks, or
  // this channel would report that something changed without saying what.
  trace('storage', 'storage.setSetting', `${key} = ${JSON.stringify(value)}`, { key, value });
}
