/**
 * The API surface.
 *
 * These call `handle` directly rather than going over a socket or stubbing
 * `fetch`. That is the point: a suite that stubbed the client's `fetch` would be
 * green whether or not any server code ran, which is the across-a-boundary
 * hollow green this repo keeps rediscovering. Deleting a route handler has to
 * turn something here red, and the last describe block is the check that it does.
 */

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handle, type ServerContext } from '../server/routes';
import { mustWrite, open, saveDocument } from '../server/store';
import { t2vaBaker } from './fixtures/guide-examples';

const dirs: string[] = [];
const tempPath = () => {
  const d = mkdtempSync(join(tmpdir(), 'h3-routes-'));
  dirs.push(d);
  return join(d, 'app.db');
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const record = (id: string, title = `title of ${id}`) => ({
  id,
  title,
  idea: `idea behind ${id}`,
  updatedAt: 1_700_000_000_000,
  doc: t2vaBaker as never,
  headVersionId: `v_${id}`,
});

/** A context over a fresh, writable database. */
function fresh(): ServerContext {
  const databasePath = tempPath();
  return { opened: open(databasePath), databasePath };
}

/** A context over a database written by a schema this build cannot write. */
function mismatched(): ServerContext {
  const databasePath = tempPath();
  const old = new Database(databasePath);
  old.exec(`CREATE TABLE documents (
    id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, deleted_at INTEGER, head_version_id TEXT,
    title TEXT GENERATED ALWAYS AS (body ->> '$.title') VIRTUAL) STRICT`);
  old.prepare('INSERT INTO documents (id, body, created_at, updated_at) VALUES (?,?,?,?)').run(
    'old1',
    JSON.stringify(t2vaBaker),
    1,
    1,
  );
  old.close();
  return { opened: open(databasePath), databasePath };
}

const get = (ctx: ServerContext, path: string) =>
  handle(new Request(`http://x${path}`), ctx);
const send = (ctx: ServerContext, method: string, path: string, body?: unknown) => {
  // GET and HEAD cannot carry one, and the route sweep below sends the same
  // fixture body to every method.
  const carries = method !== 'GET' && method !== 'HEAD' && body !== undefined;
  return handle(
    new Request(`http://x${path}`, {
      method,
      ...(carries ? { body: JSON.stringify(body) } : {}),
      headers: { 'content-type': 'application/json' },
    }),
    ctx,
  );
};

describe('documents over the API', () => {
  it('round-trips a document', async () => {
    const ctx = fresh();
    expect((await send(ctx, 'PUT', '/api/documents/d1', record('d1', 'Bakery'))).status).toBe(200);
    const res = await get(ctx, '/api/documents/d1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { record: { title: string }; schemaError: string | null };
    expect(body.record.title).toBe('Bakery');
    expect(body.schemaError).toBeNull();
  });

  it('lists them', async () => {
    const ctx = fresh();
    await send(ctx, 'PUT', '/api/documents/d1', record('d1'));
    const body = (await (await get(ctx, '/api/documents')).json()) as { id: string }[];
    expect(body.map((d) => d.id)).toEqual(['d1']);
  });

  it('404s an unknown document rather than returning an empty one', async () => {
    expect((await get(fresh(), '/api/documents/nope')).status).toBe(404);
  });

  it('soft-deletes', async () => {
    const ctx = fresh();
    await send(ctx, 'PUT', '/api/documents/d1', record('d1'));
    expect((await send(ctx, 'DELETE', '/api/documents/d1')).status).toBe(200);
    expect((await get(ctx, '/api/documents/d1')).status).toBe(404);
  });

  it('carries schemaError beside the record rather than refusing it', async () => {
    const ctx = fresh();
    const db = mustWrite(ctx.opened as never);
    saveDocument(db, { ...record('bad'), doc: { mode: 'NOT_A_MODE' } as never });
    const body = (await (await get(ctx, '/api/documents/bad')).json()) as {
      record: unknown;
      schemaError: string | null;
    };
    expect(body.record, 'it still came back').toBeDefined();
    expect(body.schemaError, 'and the failure was reported').not.toBeNull();
  });
});

describe('a mismatched database over the API', () => {
  it('reports the state on /api/status, so the UI need not wait for a save to fail', async () => {
    const body = (await (await get(mismatched(), '/api/status')).json()) as {
      writable: boolean;
      mismatch: { found: number; message: string } | null;
    };
    expect(body.writable).toBe(false);
    expect(body.mismatch!.found).toBe(0);
    expect(body.mismatch!.message).toMatch(/export/i);
  });

  it('serves reads', async () => {
    const body = (await (await get(mismatched(), '/api/documents')).json()) as { id: string }[];
    expect(body.map((d) => d.id)).toEqual(['old1']);
  });

  /**
   * 409 rather than 500. The request is well formed and the STATE prevents it,
   * which is a different thing from the server being broken -- and the client
   * can only say something useful if the two are distinguishable.
   */
  it('refuses writes with 409 and the recovery message, not 500', async () => {
    const ctx = mismatched();
    const res = await send(ctx, 'PUT', '/api/documents/d1', record('d1'));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('schema-mismatch');
    expect(body.message).toMatch(/export it to files/i);
  });

  it('refuses every write route the same way', async () => {
    const ctx = mismatched();
    for (const [method, path] of [
      ['PUT', '/api/documents/d1'],
      ['DELETE', '/api/documents/d1'],
      ['PUT', '/api/versions/v1'],
      ['PUT', '/api/settings/provider'],
      ['POST', '/api/runs'],
    ] as const) {
      expect((await send(ctx, method, path, {})).status, `${method} ${path}`).toBe(409);
    }
  });

  /** The recoveries have to work on exactly the state that needs them. */
  it('still exports, because that is the way out', async () => {
    const dump = (await (await get(mismatched(), '/api/export')).json()) as {
      documents: { id: string }[];
    };
    expect(dump.documents[0].id).toBe('old1');
  });
});

describe('settings and runs', () => {
  it('round-trips a setting', async () => {
    const ctx = fresh();
    await send(ctx, 'PUT', '/api/settings/provider', { value: 'heylook' });
    const body = (await (await get(ctx, '/api/settings/provider')).json()) as { value: unknown };
    expect(body.value).toBe('heylook');
  });

  it('records a run', async () => {
    const ctx = fresh();
    const res = await send(ctx, 'POST', '/api/runs', {
      id: 'r1',
      createdAt: 1,
      role: 'planner',
      provider: 'heylook',
      model: 'm',
      stage: 'clean',
    });
    expect(res.status).toBe(200);
    expect(
      mustWrite(ctx.opened as never).prepare('SELECT count(*) n FROM runs').get(),
    ).toEqual({ n: 1 });
  });
});

/**
 * The check dogman asked for: does deleting a route handler turn something red?
 *
 * Asserted as reachability rather than by mutating source. Every route the
 * client will call is exercised above, so this pins the list -- if a route is
 * added and nothing here calls it, this fails and says which.
 */
describe('every route is reached by a test', () => {
  const ROUTES = [
    ['GET', '/api/status'],
    ['GET', '/api/documents'],
    ['GET', '/api/documents/d1'],
    ['PUT', '/api/documents/d1'],
    ['DELETE', '/api/documents/d1'],
    ['GET', '/api/documents/d1/versions'],
    ['PUT', '/api/versions/v1'],
    ['GET', '/api/settings/k'],
    ['PUT', '/api/settings/k'],
    ['POST', '/api/runs'],
    ['GET', '/api/export'],
    ['POST', '/api/archive'],
  ] as const;

  /** A body each route will actually accept, so a 400 cannot mask a 404. */
  const bodyFor = (path: string): unknown => {
    if (path.startsWith('/api/versions/')) {
      return {
        id: 'v1',
        documentId: 'd1',
        parentId: null,
        rootId: 'v1',
        createdAt: 1,
        label: 'first',
        doc: t2vaBaker,
        operations: [],
      };
    }
    if (path.startsWith('/api/settings/')) return { value: 1 };
    if (path === '/api/runs') {
      return {
        id: 'r1',
        createdAt: 1,
        role: 'planner',
        provider: 'heylook',
        model: 'm',
        stage: 'clean',
      };
    }
    return record('d1');
  };

  it('answers every declared route with something other than not-found', async () => {
    const unreachable: string[] = [];
    for (const [method, path] of ROUTES) {
      const ctx = fresh();
      await send(ctx, 'PUT', '/api/documents/d1', record('d1'));
      const res = await send(ctx, method, path, bodyFor(path));
      // 404 from a route that exists means "no such document", which these
      // fixtures avoid. A route with no handler falls through to not-found.
      if (res.status === 404) unreachable.push(`${method} ${path} -> ${res.status}`);
      // A 400 or 500 here would mean the route was reached but the sweep sent
      // it something it cannot take, which would hide a genuine 404 behind a
      // fixture problem. Fail loudly rather than counting it as reached.
      expect([200, 409]).toContain(res.status);
    }
    expect(unreachable).toEqual([]);
  });

  it('an undeclared route is not-found, so the check above is not vacuous', async () => {
    expect((await get(fresh(), '/api/nonexistent')).status).toBe(404);
  });
});

/**
 * The boundary names a client error as one.
 *
 * Found by the route sweep above on its first honest run: it sent a body with
 * no `doc`, that reached `saveDocument`, and SQLite answered
 * `NOT NULL constraint failed: documents.body` -- a 500 naming a column, at a
 * layer the caller cannot see, for a mistake the caller made.
 *
 * Presence only. Whether a document PARSES is reported and not gated, which is
 * why `loadDocument` returns `schemaError` beside the record; validating shape
 * here would refuse to store what an older build wrote. The line is between a
 * malformed request and an outdated document.
 */
describe('a malformed write body', () => {
  it('is a 400 naming what is missing, not a database error', async () => {
    const ctx = fresh();
    const res = await send(ctx, 'PUT', '/api/documents/d1', { id: 'd1' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; missing: string[] };
    expect(body.error).toBe('bad-request');
    expect(body.missing).toContain('doc');
  });

  it('is rejected on every write route', async () => {
    const ctx = fresh();
    for (const [method, path] of [
      ['PUT', '/api/documents/d1'],
      ['PUT', '/api/versions/v1'],
      ['PUT', '/api/settings/k'],
      ['POST', '/api/runs'],
    ] as const) {
      expect((await send(ctx, method, path, {})).status, `${method} ${path}`).toBe(400);
    }
  });

  /**
   * The document that fails to PARSE still stores, because that is the case
   * reports-does-not-gate exists for. Only ABSENCE is a client error.
   */
  it('still accepts a document the schema rejects, so the guard is presence not shape', async () => {
    const ctx = fresh();
    const res = await send(ctx, 'PUT', '/api/documents/d1', {
      ...record('d1'),
      doc: { mode: 'NOT_A_MODE' },
    });
    expect(res.status).toBe(200);
    const got = (await (await get(ctx, '/api/documents/d1')).json()) as { schemaError: string | null };
    expect(got.schemaError).not.toBeNull();
  });
});
