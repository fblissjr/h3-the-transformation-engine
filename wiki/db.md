# Database & Version Lifecycle Subsystem

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

## 2. Dynamic Schema Healing (`openHealed`)

A common vulnerability in client-side IndexedDB applications is the static version upgrade failure. If another script, test suite, or browser extension opens `'H3TransformationEngine'` without defining stores, an empty database is initialized at version 1. Subsequent attempts to run `openDB(DB_NAME, 1, { upgrade })` skip the `upgrade` hook because the database is already at version 1, throwing missing store errors.

### 2.1 Complete Schema Inspection

`schemaComplete(database)` checks both store existence and necessary index registrations:
```typescript
function schemaComplete(database: IDBPDatabase<H3Schema>): boolean {
  if (!STORES.every((store) => database.objectStoreNames.contains(store))) return false;

  const transaction = database.transaction(['documents', 'versions'], 'readonly');
  return (
    transaction.objectStore('documents').indexNames.contains('updatedAt') &&
    transaction.objectStore('versions').indexNames.contains('documentId')
  );
}
```
An index omission is treated as severely as a missing store, because queries against `versions.index('documentId')` would otherwise fail silently.

### 2.2 Version-Independent Healing Protocol

`openHealed()` repairs incomplete schemas by dynamically incrementing the database version:
```typescript
async function openHealed(): Promise<IDBPDatabase<H3Schema>> {
  const existing = await openDB<H3Schema>(DB_NAME);
  if (schemaComplete(existing)) {
    return existing;
  }

  const next = existing.version + 1;
  existing.close();
  return openDB<H3Schema>(DB_NAME, next, {
    upgrade: (database, _old, _new, tx) => ensureSchema(database, tx),
  });
}
```
`ensureSchema` uses guarded store creation (`database.objectStoreNames.contains(store)`) so existing stores are preserved while missing stores or indexes are created.

---

## 3. Immutable Version Trees & Overwrite Protection

Every direct or assisted edit creates a new `StoredVersion` record. Version trees branch rather than overwrite, allowing users to navigate history or branch from any earlier point.

### 3.1 Reload Overwrite Bug & `highestSuffix`

In historical prototypes, version identifiers were allocated using an in-memory counter (`let counter = 0`). Because `counter` reset to 0 on every page refresh, the first edit after a page reload was assigned `v0001`, overwriting the root revision on disk and producing self-parent cycles (`parentId === id`).

The ground truth implementation resolves this by querying existing keys on disk:

```typescript
function highestSuffix(keys: readonly IDBValidKey[], prefix: string): number {
  return keys.reduce<number>((max, key) => {
    if (typeof key !== 'string' || !key.startsWith(prefix)) return max;
    const n = Number.parseInt(key.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
}
```

### 3.2 Single-Transaction Allocation in `recordVersion`

Allocating the version key in one operation and writing it in another would introduce a read-modify-write race under rapid concurrent edits. `recordVersion` executes the scan and `store.put` inside a single `readwrite` transaction:

```typescript
export async function recordVersion(params: {
  documentId: string;
  parentId: string | null;
  doc: H3Document;
  label: string;
  operations?: AppliedOperation[];
}): Promise<StoredVersion> {
  const tx = (await db()).transaction('versions', 'readwrite');
  const store = tx.objectStore('versions');
  const prefix = `${params.documentId}:v`;
  const keys = await store.index('documentId').getAllKeys(params.documentId);

  const version: StoredVersion = {
    id: `${prefix}${String(highestSuffix(keys, prefix) + 1).padStart(4, '0')}`,
    documentId: params.documentId,
    parentId: params.parentId,
    createdAt: Date.now(),
    label: params.label,
    doc: params.doc,
    operations: (params.operations ?? []).map((o) => ({
      path: o.path,
      before: o.before,
      after: o.after,
      rationale: o.rationale,
    })),
  };
  await store.put(version);
  await tx.done;
  return version;
}
```
Because IndexedDB serializes overlapping `readwrite` transactions on the `versions` store, concurrent edits cannot be assigned duplicate sequence IDs.

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
             1. closeDb() drops memoized connection handle.
             2. deleteReporting(DB_NAME) races deleteDB with 3s timeout.
             3. If scope === 'everything': removeAllSecrets() & destroyVault().
                                    │
                                    ▼
                         Phase 2: survey()
             Recounts rows across all stores to verify zero residue.
             isClean(after, scope) confirms clean state.
```

### 5.1 Connection Teardown & Tab Blocking Detection

1. **Closing Connections:** An open connection handle blocks deleteDatabase indefinitely. `erase()` explicitly calls `closeDb()` before invoking deleteDB.
2. **Blocked Timeout:** When another browser tab has `'H3TransformationEngine'` open, deleteDatabase hangs waiting for the other tab to close. `deleteReporting` races deleteDB against `BLOCKED_TIMEOUT_MS = 3_000`. If blocked, the report records `'H3TransformationEngine'` in `EraseReport.blocked` rather than hanging the interface.

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
