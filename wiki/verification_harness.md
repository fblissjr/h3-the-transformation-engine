# Test Infrastructure & Verification Harness Specification

**Harness Executable:** `wiki/verify.ts` (run via `bun run wiki/verify.ts`)  
**Target Knowledge Base:** `wiki/`  
**Baseline Test Suite:** `bun test` (921 tests across 28 suites)  
**Typecheck Suite:** `bun run typecheck` (`tsc --noEmit`)  
**Specification Sources:** `CLAUDE.md`, `reference/h3/contract.json`

[← Back to Master Navigation Index](index.md)

---

## 1. Test Philosophy & Design Principles

The H3 Transformation Engine LLM-Wiki test harness adheres to a strict **opaque-box, requirement-driven verification philosophy**, derived directly from the authoritative mandates in the repository specification and contract.

### Core Axioms
1. **Code is Ground Truth:**  
   Documentation must conform to code, never the reverse. Where prose claims diverge from TypeScript implementations, tests verify that the documentation acknowledges and accurately reflects the ground truth established by the code.
2. **Opaque-Box Requirement Derivation:**  
   All test expectations are derived from functional requirements, structural contracts, and observable outputs rather than internal implementation accidents.
3. **No Facade Tests & Anti-Tampering Discipline:**  
   Tests never pass vacuously. Checks that query empty sets or assert silence on inputs not provided are strictly forbidden. Meta-assertions verify that scans match real artifacts and that failure states produce non-zero exit codes with detailed diagnostic breakdown.
4. **Repository Isolation & Non-Interference:**  
   The verification harness executes tests purely in memory and within the `wiki/` boundary. Tracked repository files outside `wiki/` (`src/`, `test/`, `postmortems/`, `reference/`, `package.json`) MUST NOT be altered.
5. **Separation of Concerns:**  
   The verification harness tests documentation completeness, structural integrity, and symbol correspondence across four distinct, independently executable tiers.

---

## 2. Feature Inventory Coverage Mapping

The verification harness maps directly to the 25 features identified during survey and architecture design:

| Feature # | Feature Description | Milestone | Verification Tier in `verify.ts` | Verification Method & Assertions |
|:---|:---|:---:|:---:|:---|
| **F01** | Prose vs Code Ground-Truth Audit | M1 | Tier 1, Tier 3 | Verifies `code_doc_discrepancies.md` exists (>50 B), cites real files and lines. |
| **F02** | Code-Doc Discrepancy Ledger | M1 | Tier 1, Tier 3 | Verifies tabular/itemized discrepancy entries with exact file citations. |
| **F03** | Recognisable People Divergence Analysis | M1 | Tier 1, Tier 4 | Validates discrepancy analysis in `code_doc_discrepancies.md` and preserves baseline failure footprint in Tier 4. |
| **F04** | Stale Test Counts & Version Discrepancies | M1 | Tier 1 | Verifies documentation records 921 actual tests vs 888/719 claimed; v0.1.0 vs v0.3.0. |
| **F05** | Master Navigation Map | M2 | Tier 1, Tier 2 | Verifies `index.md` exists and links to all topic articles; verifies bidirectional backlinks. |
| **F06** | Architecture & Pipeline Guide | M2 | Tier 1, Tier 3 | Verifies `architecture.md` covers pure pipeline stages (`normalize` $\to$ `plan` $\to$ `validate` $\to$ `patch` $\to$ `serialize`). |
| **F07** | Invariants & Engineering Rules | M2 | Tier 1, Tier 3 | Verifies `invariants.md` covers Invariant 1 (prose beats), Invariant 2 (pure prompt function), purity rules. |
| **F08** | Intermediate Representation | M2 | Tier 1, Tier 3 | Verifies `core_ir.md` covers AST, Zod schemas, 19 `PATCHABLE_LEAVES`, vocabularies. |
| **F09** | Normalization Subsystem | M2 | Tier 1, Tier 3 | Verifies `core_normalize.md` covers 17k+5 frame grid, label assignment, mode inference, budgets. |
| **F10** | Validation Engine & Diagnostics | M2 | Tier 1, Tier 3 | Verifies `core_validate.md` catalogs all 29 rules and all 36 diagnostic codes. |
| **F11** | Serialization Subsystem | M2 | Tier 1, Tier 3 | Verifies `core_serialize.md` covers base modes vs Ref2VA, alignment lines, source mapping. |
| **F12** | Patch Subsystem | M2 | Tier 1, Tier 3 | Verifies `core_patch.md` covers patch operations, 4-gate verification, dialogue protection. |
| **F13** | Creative Engine & Packs | M3 | Tier 1, Tier 3 | Verifies `core_creative.md` covers 4 pack families (53 packs), 30 anchors, 5 axes, leverage scoring. |
| **F14** | Glitch Marks Subsystem | M3 | Tier 1, Tier 3 | Verifies `glitch_marks.md` covers 10 tokens, 6 surfaces, placement rules, mode constraints. |
| **F15** | Wildcards & Permutation Matrix | M3 | Tier 1, Tier 3 | Verifies `wildcards.md` covers 12 categories, 122 values, seeded PRNG, 64-combination matrix. |
| **F16** | Engineering Lessons & Postmortems | M3 | Tier 1, Tier 3 | Verifies `postmortems_lessons.md` synthesizes all 4 postmortem sessions (`2026-08-28` to `2026-09-01`). |
| **F17** | Provider Layer | M4 | Tier 1, Tier 3 | Verifies `provider.md` covers `InferenceClient`, Gemini, heylook, thinking, retry, shape trailers. |
| **F18** | Crypto & Storage Security | M4 | Tier 1, Tier 3 | Verifies `crypto.md` covers key modes (`origin`, `passphrase`, `device`), PBKDF2/AES-GCM, vault healing. |
| **F19** | Database & Version Lifecycle | M4 | Tier 1, Tier 3 | Verifies `db.md` covers IndexedDB schema healing, 3 stores, suffix versioning, wipe protocol. |
| **F20** | Telemetry & Debugging | M4 | Tier 1, Tier 3 | Verifies `debug.md` covers bounded event bus (800 events / 4MB), redaction, debug console. |
| **F21** | UI & State Management | M4 | Tier 1, Tier 3 | Verifies `ui.md` covers React component hierarchy, `useEngine` hook, serial edit queue. |
| **F22** | Operational Policy Subsystem | M4 | Tier 1, Tier 3 | Verifies `policy.md` covers policy overrides, concurrency, backpressure budgets, UI panel. |
| **F23** | E2E Test Suite & Link Validator | M5 | Tier 2 | Implements programmatic markdown link and anchor verification in `verify.ts`. |
| **F24** | Full Wiki Structural & Symbol Verification | M5 | Tier 1, 2, 3 | Verifies zero broken relative links, valid markdown anchors, and real symbol correspondence in `src/`. |
| **F25** | Regression & Integrity Gate | M5 | Tier 4 | Runs `bun run typecheck`, `bun test`, and checks git isolation status. |

---

## 3. Test Architecture & Harness Execution

The test harness is implemented as a self-contained TypeScript program in `wiki/verify.ts` and executed directly via Bun.

### Architecture Overview
```
                     bun run wiki/verify.ts
                                │
       ┌────────────────────────┼────────────────────────┐
       ▼                        ▼                        ▼
    Tier 1                   Tier 2                   Tier 3                   Tier 4
Feature Coverage        Link & Anchor        Symbol Correspondence        Repo Sanity
• 19 dedicated docs     • Relative links      • Symbol Index AST scan      • bun run typecheck
• 12 subsystems         • In-file anchors     • Exports, types, consts     • bun test baseline
• 36 diagnostics        • Cross-file anchors  • Path existence checks      • Git tree isolation
• 53 packs / 30 anchors • Code fence balance  • Hallucination detection
• Postmortems & rules   • Backlink to index
```

### Execution Commands

```bash
# Run the complete 4-tier verification suite (default)
bun run wiki/verify.ts

# Run a specific tier only (Tier 1: Coverage, Tier 2: Links, Tier 3: Symbols, Tier 4: Sanity)
bun run wiki/verify.ts --tier 1
bun run wiki/verify.ts --tier 2
bun run wiki/verify.ts --tier 3
bun run wiki/verify.ts --tier 4

# Run Tiers 1, 2, and 3 only (skipping long test runner runs during iterative editing)
bun run wiki/verify.ts --skip-tier4

# Run with verbose logging for full item-by-item pass diagnostics
bun run wiki/verify.ts --verbose

# Display help and CLI options
bun run wiki/verify.ts --help
```

### Exit Codes & Machine Readability
- **Exit Code 0:** All enabled tiers and assertions passed successfully.
- **Exit Code 1:** One or more assertions failed. A detailed error breakdown is emitted to stderr/stdout with file names, line numbers, and actionable descriptions.

---

## 4. Systematic 4-Tier Coverage Methodology

### Tier 1: Feature Coverage
Validates the presence, structural sufficiency, and mandatory subject matter of all required documentation topics in `wiki/`:
1. **19 Dedicated Articles:**
   - `index.md` (Master Navigation Map)
   - `code_doc_discrepancies.md` (Audit & Discrepancy Ledger)
   - `architecture.md` (Pipeline & Subsystem Boundaries)
   - `invariants.md` (Engineering Rules & Invariants)
   - `core_ir.md` (Intermediate Representation & AST)
   - `core_normalize.md` (17k+5 Frame Grid & Budgets)
   - `core_validate.md` (29 Rules & 36 Diagnostic Codes)
   - `core_serialize.md` (Serializers & Guide Fidelity)
   - `core_patch.md` (Patching & Dialogue Protection)
   - `core_creative.md` (Creative Packs & Anchors)
   - `glitch_marks.md` (Glitch Marks Subsystem)
   - `wildcards.md` (Wildcards & Permutation Matrix)
   - `provider.md` (InferenceClient & Backends)
   - `crypto.md` (Key Vault & Encryption)
   - `db.md` (IndexedDB Lifecycle & Versioning)
   - `debug.md` (Telemetry Sink & Redaction)
   - `ui.md` (React Hierarchy & Edit Queue)
   - `policy.md` (Operational Policies)
   - `postmortems_lessons.md` (Consolidated Engineering Lessons)
2. **12 Subsystems:**  
   Verifies that `core/ir`, `core/normalize`, `core/validate`, `core/serialize`, `core/patch`, `core/creative`, `core/wildcards`, `provider`, `crypto`, `db`, `debug`, and `ui` have dedicated, non-empty articles.
3. **36 Diagnostic Codes:**  
   Scans `core_validate.md` to verify all 36 machine-readable diagnostic codes from `src/core/validate/` are cataloged with triggers and controls:  
   `NO_SHOTS`, `DURATION_NOT_POSITIVE`, `MODE_SLOT_MISMATCH`, `SHOT_INDEX_NOT_SEQUENTIAL`, `SHOT_1_HAS_TIMESTAMP`, `SHOT_MISSING_TIMESTAMP`, `CUT_NOT_INCREASING`, `CUT_OUTSIDE_DURATION`, `SHOT_NO_BEATS`, `CAMERA_TYPE_INVALID`, `FRAME_ROLE_ON_NON_IMAGE`, `SPEAKER_ORDINALS_NOT_SEQUENTIAL`, `SPEAKER_ORDER_WRONG`, `SPEAKER_UNDECLARED`, `SPEAKER_REF_MISSING_IN_PROSE`, `SPEAKER_NOT_INTRODUCED`, `COMPOUND_SPEAKER_INVALID`, `DIALOGUE_PLACEHOLDER_MISSING`, `DIALOGUE_PLACEHOLDER_ORPHAN`, `DIALOGUE_BAD_TERMINAL`, `DIALOGUE_DECORATIVE_PUNCT`, `VOICEOVER_PHRASE_MISSING`, `SCENETRANS_UNPAIRED`, `CUTOFF_NOT_AT_END`, `VISIBLE_TEXT_NOT_QUOTED`, `SLOT_CEILING_EXCEEDED`, `SLOT_NO_ROLES`, `SLOT_ORDER_NOT_CONTIGUOUS`, `REF_MISSING_SUMMARY`, `REF_MISSING_TASK_TYPES`, `REF_TASK_TYPE_DUPLICATE`, `REF_SUMMARY_NEW_LABEL`, `REF_RETENTION_MISSING`, `REF_RETENTION_MARKER_WRONG_CLASS`, `REF_SPEAKER_IN_RETENTION`, `REF_LABEL_UNDEFINED`.
4. **Pack Families & Anchors:**  
   Scans `core_creative.md` to verify all 4 pack families (Visual `V01`–`V27`, Motion `M01`–`M08`, Finish `F01`–`F09`, Audio `A01`–`A09`, total 53 packs) and all 30 style reference anchors (`R01`–`R30`) are documented.
5. **Postmortems & Invariants:**  
   Verifies synthesis of all 4 postmortem sessions (`2026-08-28`, `2026-08-30`, `2026-08-31`, `2026-09-01`), the two core invariants, and purity rules in `test/purity.test.ts`.

---

## 5. Diagnostic Error Codes & Troubleshooting

When `bun run wiki/verify.ts` fails, it provides detailed diagnostic messages categorized by tier:

| Error Category | Diagnostic Example | Cause & Remediation |
|:---|:---|:---|
| **Tier 1: Missing Article** | `Missing expected wiki article wiki/core_ir.md` | Create the required topic article under `wiki/` with substantial content (>50 bytes). |
| **Tier 1: Missing Subsystem** | `Subsystem 'provider' is missing article wiki/provider.md` | Ensure the subsystem has its corresponding `.md` file in `wiki/` and references the subsystem name. |
| **Tier 1: Missing Diagnostic Code** | `Missing 36/36 diagnostic codes in wiki/core_validate.md` | Document the missing diagnostic code (e.g. `NO_SHOTS`) with its trigger conditions and test controls. |
| **Tier 2: Dead Relative Link** | `Broken relative link: "[Arch](architecture.md)" targets non-existent file` | Correct the link target path relative to the file containing the link. |
| **Tier 2: Dead Anchor** | `Dead anchor link: points to non-existent heading anchor "#heading"` | Check heading text spelling and verify that the target heading exists in the destination document. |
| **Tier 2: Unclosed Code Block** | `Odd number of code fence lines (5), indicating an unclosed code block` | Ensure all opening ` ``` ` code fences have a corresponding closing ` ``` `. |
| **Tier 3: Invalid File Reference** | `Referenced file path "src/core/foo.ts" does not exist in the repository` | Verify the file path in backticks exists in `src/`, `test/`, or `reference/`. |
| **Tier 3: Unknown Symbol** | `Unverified code identifier: \`FooBar\` does not correspond to any exported symbol` | Correct typo in backtick code name, or verify the symbol is exported/declared in `src/`. |
| **Tier 4: Typecheck Failure** | `TypeScript typecheck failed (exit code 1)` | Resolve TypeScript type errors without modifying existing repository files outside `wiki/`. |
| **Tier 4: Isolation Breach** | `Existing repository files outside wiki/ were modified: src/core/ir/types.ts` | Revert any changes to files outside `wiki/`. |
