/**
 * The API surface, as a plain function from Request to Response.
 *
 * Deliberately not bound to a socket. `Bun.serve` in `index.ts` is a two-line
 * adapter over this, so the tests call `handle` directly and actually execute
 * the routing, the state checks and the store calls. A suite that stubbed
 * `fetch` on the client side instead would be green whether or not any of this
 * ran -- the across-a-boundary hollow green this repo keeps rediscovering.
 *
 * The surface mirrors `server/store.ts` rather than being designed as REST. The
 * seam it replaces is already async and its signatures do not change, so the
 * swap stays mechanical and the diff stays readable.
 */

import {
  archive,
  deleteDocument,
  exportTables,
  getSetting,
  listDocuments,
  listVersions,
  recordVersion,
  loadDocument,
  eraseAll,
  recordRun,
  surveyCounts,
  saveDocument,
  saveVersion,
  setSetting,
  type Opened,
  type RunRecord,
  type StoredDocument,
  type StoredVersion,
  type WritableDb,
} from './store';

export interface ServerContext {
  opened: Opened;
  /** Where the database lives, so archive and export can name it. */
  databasePath: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A write attempted against a database this build cannot write.
 *
 * 409 rather than 500: the request is well formed and the STATE prevents it,
 * which is a different thing from the server being broken, and the client can
 * only say something useful if the two are distinguishable. The message carries
 * the recoveries, so the UI says what happened rather than "save failed".
 */
const conflict = (ctx: ServerContext) =>
  json(
    {
      error: 'schema-mismatch',
      message: ctx.opened.mismatch?.message ?? 'This database cannot be written by this build.',
      mismatch: ctx.opened.mismatch,
    },
    409,
  );

/**
 * A request body missing something the store requires.
 *
 * 400 rather than letting it reach SQLite, which would answer a malformed
 * request with `NOT NULL constraint failed: documents.body` and a 500 -- an
 * error naming a column, at a layer the caller cannot see, for a mistake the
 * caller made. The boundary is where a client error should be named as one.
 *
 * Presence only, deliberately. Whether the document PARSES is reported rather
 * than gated -- `loadDocument` returns `schemaError` beside the record for
 * exactly that reason -- so validating the shape here would refuse to store
 * what a previous build wrote. This checks only what the schema declares NOT
 * NULL, which is the difference between a malformed request and an outdated
 * document.
 */
function missing(body: unknown, fields: string[]): Response | null {
  if (typeof body !== 'object' || body === null) {
    return json({ error: 'bad-request', message: 'Expected a JSON object body.' }, 400);
  }
  const absent = fields.filter((f) => (body as Record<string, unknown>)[f] === undefined);
  return absent.length
    ? json(
        {
          error: 'bad-request',
          message: `Body is missing required ${absent.length === 1 ? 'field' : 'fields'}: ${absent.join(', ')}.`,
          missing: absent,
        },
        400,
      )
    : null;
}

/** The writable handle, or null when the state forbids writing. */
function writable(ctx: ServerContext): WritableDb | null {
  return ctx.opened.writable ? ctx.opened.db : null;
}

export async function handle(req: Request, ctx: ServerContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (!path.startsWith('/api/')) return new Response('Not found', { status: 404 });

  // --- state ---------------------------------------------------------------
  // Lets the UI show the read-only banner immediately, rather than discovering
  // the state by having a save fail. That is what makes the mismatched state
  // loud rather than a footnote.
  if (path === '/api/status' && method === 'GET') {
    return json({ writable: ctx.opened.writable, mismatch: ctx.opened.mismatch });
  }

  // --- documents -----------------------------------------------------------
  if (path === '/api/documents' && method === 'GET') {
    return json(listDocuments(ctx.opened.db));
  }

  const doc = /^\/api\/documents\/([^/]+)$/.exec(path);
  if (doc) {
    const id = decodeURIComponent(doc[1]);
    if (method === 'GET') {
      const found = loadDocument(ctx.opened.db, id);
      return found ? json(found) : json({ error: 'not-found' }, 404);
    }
    if (method === 'PUT') {
      const db = writable(ctx);
      if (!db) return conflict(ctx);
      const body = await req.json();
      const bad = missing(body, ['id', 'title', 'updatedAt', 'doc', 'headVersionId']);
      if (bad) return bad;
      saveDocument(db, body as StoredDocument);
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const db = writable(ctx);
      if (!db) return conflict(ctx);
      deleteDocument(db, id, Date.now());
      return json({ ok: true });
    }
  }

  const versions = /^\/api\/documents\/([^/]+)\/versions$/.exec(path);
  if (versions) {
    const documentId = decodeURIComponent(versions[1]);
    if (method === 'GET') return json(listVersions(ctx.opened.db, documentId));
    if (method === 'POST') {
      const db = writable(ctx);
      if (!db) return conflict(ctx);
      const body = await req.json();
      const bad = missing(body, ['label', 'doc']);
      if (bad) return bad;
      // The id and rootId are allocated here, in one transaction, rather than
      // accepted from the caller. See `recordVersion` for why.
      return json(
        recordVersion(db, { documentId, ...(body as { parentId: string | null; label: string; doc: never }) }),
      );
    }
  }

  if (/^\/api\/versions\/[^/]+$/.test(path) && method === 'PUT') {
    const db = writable(ctx);
    if (!db) return conflict(ctx);
    const body = await req.json();
    const bad = missing(body, ['id', 'documentId', 'rootId', 'createdAt', 'label', 'doc']);
    if (bad) return bad;
    saveVersion(db, body as StoredVersion);
    return json({ ok: true });
  }

  // --- settings ------------------------------------------------------------
  const setting = /^\/api\/settings\/([^/]+)$/.exec(path);
  if (setting) {
    const key = decodeURIComponent(setting[1]);
    if (method === 'GET') return json({ value: getSetting(ctx.opened.db, key, null) });
    if (method === 'PUT') {
      const db = writable(ctx);
      if (!db) return conflict(ctx);
      const body = await req.json();
      const bad = missing(body, ['value']);
      if (bad) return bad;
      setSetting(db, key, (body as { value: unknown }).value);
      return json({ ok: true });
    }
  }

  // --- measurement ---------------------------------------------------------
  if (path === '/api/runs' && method === 'POST') {
    const db = writable(ctx);
    if (!db) return conflict(ctx);
    const body = await req.json();
    const bad = missing(body, ['id', 'createdAt', 'role', 'provider', 'model', 'stage']);
    if (bad) return bad;
    recordRun(db, body as RunRecord);
    return json({ ok: true });
  }

  // --- erasing -------------------------------------------------------------
  if (path === '/api/survey' && method === 'GET') {
    return json(surveyCounts(ctx.opened.db));
  }

  /**
   * Always 200 with the counts, never 500 on a failed erase.
   *
   * The report IS the answer: `after` is re-read from storage, so a row that
   * survived is data the caller has to see rather than an exception it cannot
   * describe. Only a transport failure is an error. A mismatched database still
   * answers 409, because that is a state that prevents the write rather than a
   * failed one.
   */
  if (path === '/api/erase' && method === 'POST') {
    const db = writable(ctx);
    if (!db) return conflict(ctx);
    return json(eraseAll(db));
  }

  // --- recovery ------------------------------------------------------------
  // Both work on a mismatched database on purpose -- they are the recoveries
  // the mismatch message offers, so gating them behind writability would leave
  // the state with no way out except knowing a script exists.
  if (path === '/api/export' && method === 'GET') {
    return json(exportTables(ctx.databasePath));
  }

  if (path === '/api/archive' && method === 'POST') {
    ctx.opened.db.close();
    return json({ movedTo: archive(ctx.databasePath) });
  }

  return json({ error: 'not-found' }, 404);
}
