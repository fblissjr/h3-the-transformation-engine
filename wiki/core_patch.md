# Patch Subsystem & Surgical Modification

The **Patch Subsystem** (`src/core/patch/`) provides atomic, schema-validated, and reversible surgical editing of `H3Document` intermediate representations. It enables both LLM-driven surgical refinement and human direct-field editing without destabilizing document structure.

[Back to Master Index](index.md) | [Architecture](architecture.md) | [Invariants](invariants.md) | [Intermediate Representation](core_ir.md)

---

## 1. High-Level Architecture (`src/core/patch/apply.ts`)

In contrast to wide document re-planning (which regenerates an entire document from scratch), the patch subsystem performs granular AST updates targeted by document path syntax (e.g. `shots[0].beats[1].prose`).

```typescript
export interface AppliedOperation {
  path: string;
  before: unknown;
  after: unknown;
  rationale: string;
}

export interface RejectedOperation {
  path: string;
  reason: string;
}

export interface PatchResult {
  doc: H3Document;
  applied: AppliedOperation[];
  rejected: RejectedOperation[];
  declined: { what: string; why: string }[];
}

export function applyPatch(
  doc: H3Document,
  patch: PatchOutput,
  origin: PatchOrigin = 'model',
): PatchResult;
```

### Key Properties:
1. **Atomic Operation Processing**: Each operation in `patch.operations` is evaluated sequentially.
2. **Explicit Rejections**: Rejections are collected and returned with explanatory reasons (`rejected: RejectedOperation[]`), never silently dropped.
3. **LIFO Reversibility**: Applied patches record `before` values, allowing complete rollback via `revertPatch(doc, applied)`.
4. **Pass-Through Declines**: If the model itself declines to perform a requested transformation (e.g. if instructed to alter immutable structure), its explanation is preserved in `declined`.

---

## 2. The 4 Sequential Verification Gates

Every patch operation must successfully clear four verification gates before it can be applied to the document:

```
                  Patch Operation: { path, value, rationale }
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Gate 1: Allowlist Check           │
                     │ isPatchable(op.path)              │
                     └─────────────────┬─────────────────┘
                                       │ Pass
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Gate 2: Path Existence            │
                     │ pathExists(doc, op.path)          │
                     └─────────────────┬─────────────────┘
                                       │ Pass
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Gate 3: User Dialogue Protection  │
                     │ isProtectedDialogue(doc, op.path) │
                     └─────────────────┬─────────────────┘
                                       │ Pass (or origin === 'direct')
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Gate 4: Schema Shape & Coercion   │
                     │ leafSchema() & safeParse()        │
                     └─────────────────┬─────────────────┘
                                       │ Pass
                                       ▼
                           Applied via setAtPath()
```

### Gate 1: Allowlist Verification (`isPatchable`)
- **Check**: The path pattern (`toPathPattern(op.path)`) must match one of the 19 entries in `PATCHABLE_LEAVES` (`src/core/ir/paths.ts`).
- **Rejection Reason**: `"<pattern>" is not an editable field. Structural changes go through a dedicated operation.`
- **Rationale**: Prevents models or editors from tampering with derived scaffolding (such as `shot.index`, `speaker.ordinal`, `mode`, or `durationSeconds`).

### Gate 2: Path Existence (`pathExists`)
- **Check**: The path must already resolve to an existing property inside the document.
- **Rejection Reason**: `'Path does not exist in this document.'`
- **Rationale**: Refuses auto-vivification. A model hallucinating non-existent paths (e.g. `shots[99].camera`) is rejected rather than silently creating unindexed or orphaned data structures.

### Gate 3: User-Supplied Dialogue Protection (`isProtectedDialogue`)
- **Check**: If `origin === 'model'` and the path targets `shots[].beats[].dialogue.text`, the document is checked for `dialogue.userSupplied === true`.
- **Rejection Reason**: `'This line was supplied by the user and must be reproduced exactly. Edit it directly instead.'`
- **Rationale**: Lines entered directly by the human user carry absolute integrity protection against model modification.
- **Bypass**: Direct edits initiated by the human user pass `origin: 'direct'`, allowing the author to update their own dialogue.

### Gate 4: Schema Shape Validation & Coercion (`leafSchema` & `coerceToLeaf`)
- **Check**: The leaf's schema is looked up dynamically from `H3DocumentSchema` via `leafSchema(pattern)`.
- **Coercion**:
  - Strings representing numbers (e.g. `"5200"` for `cutAtMs`) are coerced to JavaScript `number`.
  - Delimited text strings for array leaves (e.g. `"OPEN, SALE"` for `visibleText`) are parsed into trimmed arrays via `splitList`.
- **No-Op Check**: If `before === coerced`, the operation is rejected with `'Value is unchanged.'`
- **Validation**: Value is validated via `leaf.safeParse(coerced)`.
- **Rejection Reason**: `'Not a legal value for "<pattern>": <message>.'`

---

## 3. Structural Sharing & Immutable Updates (`setAtPath`)

AST updates are performed using `setAtPath` in `src/core/ir/paths.ts`, ensuring pure immutable structural sharing:

```typescript
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const segments = parsePath(path);
  if (segments.length === 0) return value as T;
  return setIn(root, segments, value, path) as T;
}
```

### 3.1 Implementation Details of `setIn`
- **Reference Preservation**: Unmodified branches of the AST retain their reference identities (`===`). React components and memoized selectors observe re-renders only on the specific branch that changed.
- **Array Handling**: Clones arrays using `.slice()` and updates the specific index. Throws out-of-range errors if an index is negative or $\ge \text{length}$.
- **Object Handling**: Clones objects using `{ ...obj }`.
- **Anti-Auto-Vivification**: Explicitly verifies `head in obj`. An attempt to write a missing property on an existing container throws rather than silently adding the field.

---

## 4. Reverting Patches (`revertPatch`)

Because every applied operation records its `before` value, patches can be cleanly undone in Last-In-First-Out (LIFO) order:

```typescript
export function revertPatch(doc: H3Document, applied: AppliedOperation[]): H3Document {
  let next = doc;
  for (const op of [...applied].reverse()) {
    next = setAtPath(next, op.path, op.before);
  }
  return next;
}
```

This mechanism underpins version tree rollbacks and interactive undo actions in the workbench.

---

## 5. Direct Editing Pipeline Integration (`editDirect`)

In `src/pipeline.ts`, direct user updates from the UI editor (e.g. typing into a text input or selecting a camera motion from a dropdown) channel through `editDirect`:

```typescript
export function editDirect(
  doc: H3Document,
  path: string,
  value: unknown,
): { doc: H3Document; validation: ValidationResult; prompt: SerializeResult } {
  const patch: PatchOutput = {
    operations: [{ path, value: String(value), rationale: 'Direct user edit' }],
    declined: [],
  };

  const { doc: next, rejected } = applyPatch(doc, patch, 'direct');
  if (rejected.length > 0) {
    throw new Error(`Edit rejected: ${rejected[0].reason}`);
  }

  const ctx = contextFor(next);
  const validation = validate(next, ctx);
  const prompt = serialize(next, ctx);

  return { doc: next, validation, prompt };
}
```

`editDirect` unifies human edits with the same 4-gate verification engine while setting `origin: 'direct'`, immediately re-normalizing context, re-validating the AST, and re-serializing the prompt in a single turn.

---

## 6. Related Articles

- **[Master Index](index.md)**: Master knowledge base.
- **[Architecture & Pipeline](architecture.md)**: Overall pipeline data flow.
- **[Intermediate Representation](core_ir.md)**: Detailed AST and the 19 `PATCHABLE_LEAVES`.
- **[Validation Engine](core_validate.md)**: Complete diagnostic rules catalog.
