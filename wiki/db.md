`exportTables`# Database & Version Lifecycle Subsystem

[Documentation Index](index.md) | [Architecture](architecture.md) | [Cryptographic Storage](crypto.md) | [UI & State Management](ui.md) | [Operational Policy](policy.md) | [Telemetry & Debugging](debug.md)

---

## 1. Overview & Store Architecture

The persistence layer (`src/db/`) manages document state, branching revision histories, and operational preferences in IndexedDB. Built on the lightweight `idb` wrapper, it establishes a minimal schema consisting of three stores rather than a sprawling multi-store database:

Database Identifier: `DB_NAME = 'H3TransformationEngine'`  
Store Names: `STORES = ['documents', 'versions', 'settings'] as const`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    IndexedDB: H3TransformationEngine                         │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1. documents Store (keyPath: 'id')                                           │
│    - Record: StoredDocument { id, title, updatedAt, doc, headVersionId }     │
│    - Index: 'updatedAt' (numeric timestamp for sort order)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ 2. versions Store (keyPath: 'id')                                            │
│    - Record: StoredVersion { id, documentId, parentId, createdAt, doc, ... } │
│    - Index: 'documentId' (groups revision history by document)               │
├──────────────────────────────────────────────────────────────────────────────┤
│ 3. settings Store (keyPath: 'key')                                           │
│    - Record: StoredSetting { key, value }                                    │
│    - Keys: 'provider', 'heylookModel', 'instance-policy', etc.               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Architectural Philosophy: No Migration Overhead

The transformation engine deliberately avoids traditional data migration scripts. Because prompt compiler documents are lightweight artifacts that can be regenerated from ideas or exported prompts, complex database migration pipelines represent an unnecessary risk of data loss. Instead, the storage layer relies on:
1. **Dynamic Schema Healing:** Missing stores and indexes are created on demand without dropping data.
2. **Schema Reporting on Read:** `loadDocument` parses stored documents with `H3DocumentSchema.safeParse`. If a stored document does not conform to the latest schema, `describeSchemaFailure` returns an explanatory warning rather than refusing to load the document.

---

## 2. Schema Lineage (`PRAGMA user_version`)

The store moved from IndexedDB to SQLite behind a local server. What replaced versionless schema repair is a stamped lineage, and the failure it guards is different in kind: not a half-created schema, but a database written by a build whose columns this one no longer matches.

### 2.1 The Stamp and Its Pin

`server/store.ts` stamps `PRAGMA user_version` and compares it on open. The number is monotonic, starting at 1, and is bumped only for a change that makes an older file unwritable — additive changes do not bump it.

A hand-incremented number is a guarantee held by someone remembering, so the suite pins the expected value against a sha256 of `server/schema.sql`. Editing the schema without bumping the version turns the suite red. That converts the maintained list into something enforced, which is the same move `contract.sources` makes for the guide files.

### 2.2 Read-Only Opening, Not Refusal and Not Migration

On a mismatch the file opens **read-only**. Every read serves, every write refuses, and the file is not touched.

That resolves what looks like a conflict between two rules and is not one. "A build that refuses to open what the previous build wrote loses work that exists nowhere else" is about **contents**; "no data migrations, deliberately" is about the **container**. Honouring both means never losing the bytes and never writing per-version migration code, which read-only satisfies exactly: every document remains openable, nothing is rewritten.

`open` returns `{ db, writable, mismatch }` rather than throwing, and `WritableDb` is a branded type, so narrowing on `writable` is what produces a handle the write functions accept. A write against a mismatched database is a compile error rather than a runtime surprise at an unrelated call site.

The recovery path is `exportTables`, which works on exactly the files `open` will not write — it derives each table's column list at read time from `pragma_table_xinfo` where `hidden` is 0, so generated columns are excluded and the dump re-imports. `archive` moves a file aside with its `-wal` and `-shm` sidecars rather than deleting it; leaving the sidecars behind is how a stale write log gets replayed into a fresh database of the same name.

## 3. Immutable Version Trees & Overwrite Protection

Every direct or assisted edit creates a new `StoredVersion` record. Version trees branch rather than overwrite, allowing users to navigate history or branch from any earlier point.

### 3.1 Id Allocation Moved to the Server

In historical prototypes, version identifiers came from an in-memory counter that reset on every page refresh, so the first edit after a reload was assigned `v0001`, overwriting the root revision and producing self-parent cycles (`parentId === id`). The browser fix was to derive the next id from the keys already on disk.

That fix is now unnecessary rather than merely superseded. Allocation happens on the server, inside one SQLite transaction, with `rootId` derived there rather than accepted from the caller. The read-then-write race the browser transaction existed to prevent is prevented by SQLite plus the server being the only writer, which is strictly stronger than a same-tab guarantee.

Two consequences worth having:

- **A timestamp is not an ordering.** Two versions written in the same millisecond tied on `created_at` and fell back to storage order. Ids are zero-padded and break the tie. This was assumed unique twice in one arc and found by a test rather than by review.
- `root_id` is stored alongside `parent_id` even though lineage is walkable from parents alone, because "every version of this document" is otherwise a recursive CTE written fifty times.
### 3.2 One Transaction, on the Server

Allocating the version key in one operation and writing it in another introduces a read-modify-write race. The browser implementation avoided that by doing both inside a single `readwrite` transaction; the server does the same thing inside one SQLite transaction, with the additional property that there is only ever one writer.

The client's part is now a POST. `postVersion` in `src/db/db.ts` hands over the document, the parent and the label, and receives the allocated record back — it does not choose the id, so no client can allocate a colliding one.

### 3.3 Parent Cycle Detection (`inCycle`) & Tree Assembly

`buildTree(versions)` constructs a hierarchy of `VersionNode` elements. If historical bugs or corrupted data created cycles where a version points to itself or an ancestor, naive tree builders enter infinite loops or drop root nodes.

`buildTree` implements `inCycle(id)` to inspect parent chains:
```typescript
const inCycle = (id: string): boolean => {
  const seen = new Set<string>([id]);
  let cursor: string | null = nodes.get(id)?.version.parentId ?? null;
  while (cursor != null && nodes.has(cursor)) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return false; // Upstream cycle; not in this node's loop
    seen.add(cursor);
    cursor = nodes.get(cursor)?.version.parentId ?? null;
  }
  return false;
};
```
- **Cycle Hoisting:** Nodes caught in a cycle are hoisted to the root level as visible orphans rather than vanishing from the UI.
- **Descendant Preservation:** Nodes descended from a damaged parent are not falsely marked as in-cycle, preserving linear subtrees.
- `flattenTree(roots)`: Performs depth-first traversal to produce indented lists for UI rendering.
- `ancestryOf(versions, id)`: Traverses parent links back to the root, returning the chronological sequence of versions leading to the target.

---

## 4. Document Operations & Cascading Deletion

`src/db/db.ts` provides document CRUD operations:
- `saveDocument(record)`: Saves `StoredDocument` to the `documents` store and traces storage events.
- `loadDocument(id)`: Retrieves a document record and verifies schema conformance via `describeSchemaFailure`. If the schema fails, the record is still returned with `schemaError` so users can access their data.
- `listDocuments()`: Reads all documents indexed by `updatedAt` in reverse chronological order.
- `deleteDocument(id)`: Atomically deletes the document from `documents` and cascades to delete all associated revisions from `versions` using the `documentId` index. This prevents orphaned revision trees from consuming storage indefinitely.
- `getSetting(key, fallback)` / `setSetting(key, value)`: Simple key-value operations on the `settings` store.

---

## 5. Two-Phase Storage Wipe Protocol (`src/db/wipe.ts`)

Erasing persistent browser state reliably requires handling database locks, cached handles, and residue verification. `src/db/wipe.ts` implements a two-phase protocol:

```
                      Survey-Erase-Survey Protocol
                                    │
                                    ▼
                         Phase 1: survey()
             Counts rows in documents, versions, settings,
             vault keys, and h3-secure:* keys.
                                    │
                                    ▼
                             Teardown & Erase
             1. POST /api/erase; the server deletes and re-counts.
             2. deleteReporting races the vault delete with a 3s timeout.
             3. If scope === 'everything': removeAllSecrets() & destroyVault().
                                    │
                                    ▼
                         Phase 2: survey()
             Recounts rows across all stores to verify zero residue.
             isClean(after, scope) confirms clean state.
```

### 5.1 Connection Teardown & Tab Blocking Detection

1. **Two stores, one report.** Documents, versions, settings and runs are deleted by the server, which re-reads its own counts afterwards and returns them; the key vault is deleted in the browser. A store the survey cannot see is one it would report as erased while the data sits on disk, which is why `runs` is in the survey — `raw_output` holds prompt text.
2. **A failed erase is a 200 with `clean: false`, never a 500.** The report is the answer, and only a transport failure is an error. The client must then say "could not verify" rather than "erased": the property that has to survive the process boundary is that erasing reports what storage says, not what the code did.
3. **Blocked Timeout (vault only).** When another browser tab holds the vault database open, the delete hangs waiting for it. `deleteReporting` races it against `BLOCKED_TIMEOUT_MS = 3_000` and records the name in `EraseReport.blocked` rather than hanging the interface.

### 5.2 Erase Scopes & Residue Verification

`EraseScope` determines the extent of data removal:
- `'documents'`: Clears documents, versions, and settings. API keys and encrypted secrets are preserved.
- `'everything'`: Additionally removes all `h3-secure:*` secrets from `localStorage` and destroys the key vault database via `destroyVault()`.

Post-erase verification (`isClean(after, scope)`) queries the database and confirms that every store has exactly 0 rows.

---

## 6. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): Overview of data flow and computational kernel boundaries.
- [Cryptographic Storage](crypto.md): Details of key modes, envelope encryption, and 'H3KeyVault' healing.
- [UI & State Management](ui.md): Hook integration via `useEngine.ts` and serial queue coordination.
- [Operational Policy](policy.md): Storage of machine overrides in the `settings` store under `instance-policy`.
- [Telemetry & Debugging](debug.md): Storage channel event tracing via `trace('storage', ...)`.
