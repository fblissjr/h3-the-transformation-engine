# Code vs. Documentation Discrepancies & Ground-Truth Audit

**Document:** `wiki/code_doc_discrepancies.md`  
**Audit Author:** `teamwork_preview_worker_m1`  
**Audit Timestamp:** 2026-09-03T14:20:00Z  
**Target Repository:** `/Users/fredbliss/workspace/h3-transformation-engine`  
**Baseline Test Execution:** 921 tests across 28 suites (915 passing, 6 failing due to prompt deletions)  
**TypeScript Typecheck:** `bun run typecheck` (`tsc --noEmit`) passes with 0 errors  
**Authoritative Rule:** Code and executed tests are the ground truth. Existing repository files outside of `wiki/` remain untouched.

[← Back to Master Navigation Index](index.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Master Discrepancy Ledger](#2-master-discrepancy-ledger)
3. [Critical Breaking Discrepancy: Recognisable People Prompt Rule Deletion](#3-critical-breaking-discrepancy-recognisable-people-prompt-rule-deletion)
4. [Missing Subsystems & Architectural Omissions](#4-missing-subsystems--architectural-omissions)
   - [4.1 Complete Omission of Operational Policy Subsystem](#41-complete-omission-of-operational-policy-subsystem)
   - [4.2 Relocated and Generalized JSON Extraction Subsystem](#42-relocated-and-generalized-json-extraction-subsystem)
5. [Metrics, Versioning & Repository Metadata Divergences](#5-metrics-versioning--repository-metadata-divergences)
   - [5.1 Test Suite Counts Discrepancy](#51-test-suite-counts-discrepancy)
   - [5.2 Package Version Number Mismatch](#52-package-version-number-mismatch)
6. [Format, Syntax & Vocabulary Divergences](#6-format-syntax--vocabulary-divergences)
   - [6.1 Alignment Line Syntax Divergence: FL2VA Bare vs. L2VA Bracketed Format](#61-alignment-line-syntax-divergence-fl2va-bare-vs-l2va-bracketed-format)
   - [6.2 Purged Budget Exports & Warning Severity Elimination](#62-purged-budget-exports--warning-severity-elimination)
7. [Historical Postmortem Traps vs. Implemented Code Invariants](#7-historical-postmortem-traps-vs-implemented-code-invariants)
   - [7.1 Traps from Session 1 (2026-08-28: Glitch, Wildcards, Contract)](#71-traps-from-session-1-2026-08-28-glitch-wildcards-contract)
   - [7.2 Traps from Session 2 (2026-08-30: heylook Provider)](#72-traps-from-session-2-2026-08-30-heylook-provider)
   - [7.3 Traps from Session 3 (2026-08-31: Debug Console & Telemetry)](#73-traps-from-session-3-2026-08-31-debug-console--telemetry)
   - [7.4 Traps from Session 4 (2026-09-01: Conformance Harness & Local Models)](#74-traps-from-session-4-2026-09-01-conformance-harness--local-models)
   - [7.5 Standing Invariants Recorded in CLAUDE.md](#75-standing-invariants-recorded-in-claudemd)
8. [Actionable Remediation & Synchronization Plan](#8-actionable-remediation--synchronization-plan)

---

## 1. Executive Summary

The H3 Transformation Engine is a prompt compiler and structured editor for MiniMax H3 video generation models (supporting modes `T2VA`, `I2VA`, `FL2VA`, `L2VA`, and `Ref2VA`). It operates strictly as a prompt compilation and transformation pipeline without native video generation capabilities.

This audit report delivers an exhaustive, forensic comparison between all existing documentation in the repository—including `CLAUDE.md`, `README.md`, `VISION.md`, `PLAN.md`, historical postmortems in `postmortems/` (Sessions 1 through 4), and official vendor reference materials in `reference/h3/` (`contract.json`, `VIDEO_PROMPT_WRITING_GUIDE_base_en.md`, `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md`)—against the active TypeScript codebase in `src/` and automated tests in `test/`.

### Core Auditing Principles
1. **Code is Ground Truth:** Where narrative claims, architectural diagrams, or contract assertions conflict with running TypeScript code, the code reflects reality.
2. **Strict Forensic Attribution:** Every recorded divergence identifies the exact prose document and line number, the exact code file, line, and symbol, the precise divergence classification, and the exact runtime behavior.
3. **Repository Preservation:** Existing code and documentation files outside of `wiki/` remain completely untouched during this audit.

---

## 2. Master Discrepancy Ledger

| # | Discrepancy Name | Prose Source & Location | Code Ground Truth & Symbol | Discrepancy Nature | Impact / Severity |
|---|---|---|---|---|---|
| **D-01** | Recognisable People Prompt Guidance Deletion | `README.md:120–127`<br>`contract.json:727–734, 990–996`<br>`test/creative-integration.test.ts:516–555`<br>`test/contract.test.ts:691–709` | `src/provider/prompts/planner.ts`<br>`src/provider/prompts/patch.ts`<br>(Commits `9b39c6a`, `71d5362`) | Prose and tests demand `# Recognisable people` prompt block; code completely deleted it | **Critical**: Causes 6 test failures in test suite |
| **D-02** | Operational Policy Subsystem Omission | `README.md:49–64` (§ Layout)<br>`README.md:35–37` (§ Pipeline) | `src/core/policy/` (5 files)<br>`src/db/policy.ts:1–171`<br>`src/ui/PolicyPanel.tsx:1–225` | Layout tree and architecture completely omit instance-level policy engine | **High**: Subsystem undocumented in main architecture |
| **D-03** | Stale Test Suite Counts Across Docs | `CLAUDE.md:77` (claims 888 tests)<br>`README.md:214` (claims 719 tests)<br>Postmortem 3 (claims 700 / 682 tests) | `test/` (28 test files)<br>`package.json:10` (`vitest run`) | Outdated test counts documenting past historical snapshots | **Medium**: Documentation drift (reality: 921 tests) |
| **D-04** | Package Version Number Mismatch | `package.json:4` (`"version": "0.1.0"`) | `CHANGELOG.md:476` (`## [0.3.0]`)<br>Postmortem 1 forward item 5 | `package.json` was never incremented to match released versions in changelog | **Medium**: Metadata version desynchronization |
| **D-05** | Relocated JSON Extraction Module | Postmortem 2:19, 56–57 (`src/provider/heylook/json.ts`) | `src/provider/shape.ts:141`<br>(`extractJsonObject`, `withShapeTrailer`) | `json.ts` was deleted and unified into provider-agnostic `src/provider/shape.ts` | **Low**: Historical path reference stale in postmortem |
| **D-06** | Alignment Line Syntax Divergence | Generic assumption of uniform bracketed syntax | `src/core/ir/vocab.ts:56–73`<br>`src/core/serialize/shared.ts:71–76`<br>`base_en.md:25, 31, 201, 215` | FL2VA uses bare identifiers; L2VA uses angle/square bracketed identifiers | **High**: Asymmetrical vendor guide syntax fidelity |
| **D-07** | Purged Budget Exports & Warnings | Historical comments referencing `MIN_SHOT_MS`, `comfortableLatestCutMs`, warnings | `src/core/normalize/budgets.ts:79–86`<br>`src/core/validate/types.ts:1–35` | 4 exports removed; warning severity permanently eliminated from validator | **Medium**: Stale API references in legacy discussions |
| **D-08** | Typographic Apostrophe Drift | Early fixtures in tests had U+2019 curly apostrophes | `src/core/ir/examples.ts`<br>`test/guide-fidelity.test.ts:31–72` | 13 non-ASCII characters drifted into golden tests; vendor guides use ASCII | **Resolved in Code**: Enforced by strict ASCII test gate |
| **D-09** | Glitch Off Button Mode Hijacking | Postmortem 1:85–91 noted Off button selected `directed` | `src/ui/CreativePanel/CreativePanel.tsx`<br>`src/core/creative/resolver.ts:98–132` | Pressing Off with glitch marks active previously forced `directed` mode | **Resolved in Code**: Decoupled mode selection from marks |
| **D-10** | Wildcard Prototype Pollution Trap | `{constructor}` placeholder in templates | `src/core/wildcards/matrix.ts:54–58`<br>(`Object.create(null)`) | Evaluated `{constructor}` against `Object.prototype`, stringifying prototype code | **Resolved in Code**: Plain null-prototype dictionaries used |
| **D-11** | Creative & Roll Stamping Placement | Postmortem 1:135–137 noted stamping was in `compile` | `src/core/assemble.ts:241–255` | Stamping placed post-model in `compile` was unreachable by unit tests | **Resolved in Code**: Stamping moved into pure `assemble()` |
| **D-12** | Timestamp Patchability Invariant | `VISION.md:87–92` vs. maintenance allowlist | `src/core/ir/paths.ts:115–135`<br>(`shots[].cutAtMs` in `PATCHABLE_LEAVES`) | Claimed held by construction, but actually maintained in explicit allowlist | **Documented**: Verified on explicit allowlist |
| **D-13** | Ref2VA Dual-Label Retention Collision | Postmortem 1:143–147: slot keying masked dual labels | `src/core/normalize/labels.ts:55–75`<br>`src/core/serialize/ref2va.ts:104–125` | Video slot with audio role earns both `<Video N>` and `<Audio M>` labels | **Resolved in Code**: Retention keys by label, not slot ID |
| **D-14** | Aborting Non-Streaming heylook Calls | `README.md:195–201` claimed abort releases server queue | `src/provider/heylook/client.ts:471–501`<br>(`DELETE /v1/requests/{requestId}`) | Non-streaming fetch abort left server running; fixed via explicit REST delete | **Resolved in Code**: Explicit DELETE endpoint issued |
| **D-15** | `retryAfterMs` Fallthrough on Negative Values | Postmortem 2:53–56 noted `Date.parse("-1")` returned a year | `src/provider/heylook/client.ts:701–716` | Fallthrough treated negative numeric strings as dates, causing 0s busy loops | **Resolved in Code**: Strict positive integer guard applied |
| **D-16** | `extractJsonObject` First / Longest Match Traps | Postmortem 2:56–60: preamble `{}` or schema echo picked | `src/provider/shape.ts:141–187`<br>(`resemblance` ranking) | Unconstrained models returned preamble braces or echoed schema definition | **Resolved in Code**: Key resemblance scoring ranks candidates |
| **D-17** | Capability Gating vs. Modality Advertising | Postmortem 2:75–86: MLX stripped vision towers | `src/provider/heylook/models.ts:141–145`<br>(`canServe` checks `capabilities`) | Checkpoints declare `modalities: ['vision']` but server loader strips them | **Resolved in Code**: Checked against runtime `capabilities` |
| **D-18** | Shape Trailer Invisibility in Contract Tests | Postmortem 2:61–66: contract test checks prompt builders | `src/provider/shape.ts:90–96`<br>`test/heylook.test.ts` | Schema trailer appended downstream of builder; `contract.test.ts` blind to it | **Documented Invariant**: Asserted in provider tests |
| **D-19** | Empty Subject Sources Schema Violation | Postmortem 2:122–130: prompt asked for empty `sources` | `src/core/ir/schema.ts:148`<br>`src/provider/prompts/planner.ts:285–300` | Schema requires `min(1)` for `sources`, causing validation failures | **Resolved in Code**: Contract-keyed instruction applied |
| **D-20** | Sampling Temperature Policy & Owner Ruling | Postmortem 2:254–259; `CLAUDE.md:39–40` | `src/provider/gemini.ts:111–155`<br>`src/provider/heylook/client.ts:182` | Gemini ignores temperature; owner ruled temperature must be $\ge 1.0$; no deterministic mode | **Enforced in Code**: Temperature omitted from payload |
| **D-21** | Version ID Collision on Page Reload | Postmortem 3:94–106: module counter reset on reload | `src/db/versions.ts:52–98`<br>(`highestSuffix` query) | `nextId = 1` counter clobbered `workspace:v0001` on every browser reload | **Resolved in Code**: Atomic transaction reads max existing key |
| **D-22** | Version Tree Parent Cycle Trapping | Postmortem 3:101–106: self-parenting overwrites | `src/db/versions.ts:146–157`<br>(`inCycle` detection) | Historical bugs created cycles (`parentId === id`), hiding versions from UI | **Resolved in Code**: Cycles detected and nodes hoisted to root |
| **D-23** | Partial Record Trace Crash in Storage Telemetry | Postmortem 3:68–72: reading `doc.shots.length` threw | `src/db/db.ts:153–157`<br>`src/debug/redact.ts:120–150` | Storage trace assumed full document AST on partial test records | **Resolved in Code**: Defensive optional chaining applied |
| **D-24** | Oversized Telemetry Event Bus Bounding | Postmortem 3:47–55, Postmortem 4:159–164 | `src/debug/bus.ts:125–160`<br>(`MAX_EVENT_BYTES = 500,000`) | Enormous single event (>500KB) evicted entire 4MB memory history buffer | **Resolved in Code**: Single events capped; summary preserves keys |
| **D-25** | Negative Prose Assertions Blind to Rewording | Postmortem 4:88–98: `expect().not.toContain()` blind | `test/creative-integration.test.ts`<br>(Composition checks) | Reworded defects bypassed negative string match checks | **Resolved in Tests**: Whole-prompt composition equality checks |
| **D-26** | Thinking Level Minimal Rejected by Gemini | `CLAUDE.md:41` | `src/provider/gemini.ts:53–70`<br>(`ThinkingLevel = 'low' \| 'medium' \| 'high'`) | Google SDK advertises `minimal`, but `gemini-3.7-flash` returns HTTP 400 | **Enforced in Code**: Type narrowed; floor set to `'low'` |
| **D-27** | Versionless IndexedDB Opening & Self-Healing | `CLAUDE.md:49` | `src/db/db.ts:118–142` (`openHealed`)<br>`src/crypto/secureStore.ts:114–121` (`vault`) | Specifying DB version 1 prevents `upgrade` if empty DB pre-exists on origin | **Enforced in Code**: Open versionless, inspect stores, bump version |
| **D-28** | Legacy Device Key Mode Decrypt-Only | `CLAUDE.md:48` | `src/crypto/secureStore.ts:60, 222–225`<br>(`WritableKeyMode` excludes `'device'`) | `device` mode derived key from public `navigator` properties; insecure to write | **Enforced in Code**: Read/decrypt only; writing throws error |
| **D-29** | Scoped Word Budget on Ref2VA Documents | `CLAUDE.md:27`<br>`reference/h3/contract.json:970` | `src/core/ir/vocab.ts:341`<br>`test/guide-fidelity.test.ts:75–115` | Ref guide 5.2 states 350–500 words for generation; edits/dialogue exempt | **Enforced in Code**: Scoped to generation tasks only |

---

## 3. Critical Breaking Discrepancy: Recognisable People Prompt Rule Deletion

### 3.1 Divergence Summary & Forensic History
The repository documentation, machine-readable contract, and test suites state that the prompt compiler enforces house guidance instructing the model to describe widely recognised public figures rather than naming them. However, commits `9b39c6a` and `71d5362` modified and then completely deleted this guidance from the codebase, causing 6 test failures across 2 test suites.

```
Git History of Deletion:
Commit 9b39c6a (2026-09-01T17:43:40-05:00): "change prompt"
  ├── src/provider/prompts/patch.ts:
  │     Replaced "A recognisable person is described, never named..." with:
  │     "Write only once the proper name or character name that is well-recognized... Then describe them..."
  └── src/provider/prompts/planner.ts:
        Replaced strict prohibition with:
        "Write only once the proper name or character name that is well-known. Describe them as well..."

Commit 71d5362 (2026-09-01T17:54:25-05:00): "change prompt"
  ├── src/provider/prompts/patch.ts:
  │     Completely deleted the recognisable people instruction block (lines 42–44).
  └── src/provider/prompts/planner.ts:
        Completely deleted "# Recognisable people" heading and all accompanying sentences (lines 69–77).
```

### 3.2 Prose Documentation Claims
1. **`README.md` (lines 120–127, § Recognisable people):**
   > *"A widely recognised person, living, dead or fictional, reaches the prompt as the role they are known for, the era, the dress, and the traits that identify them on sight — never the proper name... In both the planner and the patch prompts, so an edit cannot introduce a name the prose was written to avoid."*
2. **`reference/h3/contract.json` (lines 727–734, 990–996):**
   - Declares block `{"heading": "# Recognisable people", "source": "core", "conditional": false}` inside `prompts.planner.blocks`.
   - Lists `"id": "recognisable-people"` in `notInTheGuides` with target paths `src/provider/prompts/planner.ts` and `src/provider/prompts/patch.ts`.

### 3.3 Ground-Truth Code Reality
- **`src/provider/prompts/planner.ts` (lines 65–85):**
  Transition from single-frame visibility rules directly to `# Camera`:
  ```ts
  Every property has to be present in a single frame. If a still could not show it, neither can the video -- what a character does for a living, what they did yesterday, what they are about to decide.

  # Camera

  Write camera motion as natural action inside a sentence...
  ```
  The block `# Recognisable people` is **completely absent**.
- **`src/provider/prompts/patch.ts` (lines 40–50):**
  The sentence `"A recognisable person is described, never named..."` is **completely absent**.

### 3.4 Failing Test Suite Audit (6 Tests Red)
Running `bun test` or `vitest run` executes 921 tests, producing 915 passes and exactly 6 failures:

1. **`test/creative-integration.test.ts:519` (`recognisable people > is in the planner prompt, in every mode`):**
   - *Failure:* `expect(prompt, mode).toContain('# Recognisable people')` fails for modes `T2VA`, `I2VA`, `FL2VA`, `L2VA`, and `Ref2VA`.
2. **`test/creative-integration.test.ts:529` (`recognisable people > teaches the substitution rather than only forbidding the name`):**
   - *Failure:* `expect(prompt).toContain('the role they are known for')` and `expect(prompt).toContain('bicorne hat')` fail.
3. **`test/creative-integration.test.ts:543` (`recognisable people > exempts the two fields that are reproduced verbatim`):**
   - *Failure:* `expect(prompt).toContain('It does not apply to two things that are reproduced exactly as given')` and `expect(prompt).toContain('If a character says a name, they say it.')` fail.
4. **`test/creative-integration.test.ts:550` (`recognisable people > is in the patch prompt, so an edit cannot introduce one`):**
   - *Failure:* `expect(prompt).toContain('A recognisable person is described, never named')` and `expect(prompt).toContain('are the exception')` fail.
5. **`test/contract.test.ts:694` (`prompt blocks match the spec > the planner carries every declared block, in order`):**
   - *Failure:* `planner.indexOf('# Recognisable people')` returns `-1`. Assertion `expect(positions[i]).toBeGreaterThanOrEqual(0)` throws with message: `planner is missing "# Recognisable people"`.
6. **`test/contract.test.ts:702` (`prompt blocks match the spec > the planner omits exactly the blocks the spec calls conditional`):**
   - *Failure:* `plannerBare.includes('# Recognisable people')` evaluates to `false` on a block declared `conditional: false`.

### 3.5 Ground-Truth Assessment
By user mandate, the code is the ground truth. Commits `9b39c6a` and `71d5362` reflect intentional changes made by the repository owner to remove prompt-level naming restrictions. The documentation (`README.md`, `contract.json`) and test suite assertions are out of sync with this code reality.

---

## 4. Missing Subsystems & Architectural Omissions

### 4.1 Complete Omission of Operational Policy Subsystem

#### Prose Claim in Documentation
In `README.md` (lines 49–64, § Layout), the directory structure of `src/` is documented as:
```text
src/core/        pure TypeScript, no React, no DOM, no network (enforced by a test)
  ir/            document types, zod schemas, path addressing, the closed vocabularies
  normalize/     duration, label assignment, mode inference, budgets
  validate/      29 rules emitting 36 error codes, each with a fixture that makes it go red
  serialize/     source-mapped emitter, both output contracts
  patch/         path-scoped patch application
  creative/      style packs, anchors, strength scoring, glitch marks
  wildcards/     {category} substitution on the idea, and the experiment matrix
src/provider/    the client interface, a Gemini and a heylook client, and the planner/patch prompts
src/debug/       the in-memory trace buffer, redaction, and the InferenceClient decorator
src/crypto/      at-rest storage for the API key, three modes
src/db/          IndexedDB, three stores, immutable version tree, erase-and-verify
src/ui/          slot manager, document editor, prompt view, diagnostics, history, local data, debug console
reference/h3/    the two official guides, and contract.json — the machine-readable spec
```

#### Ground-Truth Code Implementation
A full operational policy subsystem exists across three architectural layers (`core`, `db`, and `ui`), comprising 7 source files and 2 dedicated test suites:

1. **Pure Computational Kernel (`src/core/policy/`):**
   - `defaults.ts` (lines 1–55): Declares `GLOBAL_POLICY` (`concurrency: 1`, `backpressureBudgetMs: 300,000`, `timeoutMs: 600,000`, `enforceSchema: false`) and `PROVIDER_TYPE_POLICY` (`metered` vs `self-operated`).
   - `fields.ts` (lines 1–105): Declares `POLICY_FIELDS` schema defining field kinds (`integer`, `duration_ms`, `boolean`), validation bounds, default values, and whether the field is user-settable.
   - `types.ts` (lines 1–110): Defines `Policy`, `Scope` (`'global' | 'provider_type' | 'instance' | 'model'`), `PolicyLayers`, `Sourced<T>`, and `ProviderType`.
   - `resolve.ts` (lines 1–75): Pure resolution functions (`resolvePolicy`, `resolveAttribute`, `explainPolicy`, `layersFrom`). Implements 4-tier cascade where higher scopes override lower scopes.
   - `index.ts` (lines 1–21): Barrel module re-exporting with explicit `.ts` extensions to support Node runtime import under `vite.config.ts`.
2. **Persistence Boundary (`src/db/policy.ts`, lines 1–171):**
   - Stored in IndexedDB `settings` store under key `INSTANCE_POLICY_SETTING = 'instance-policy'`.
   - Validates writes per attribute dynamically via `validatorFor(key)`.
   - Reports schema errors without bricking the app (`loadInstancePolicies`).
3. **User Interface (`src/ui/PolicyPanel.tsx`, lines 1–225):**
   - Header disclosure panel rendering every policy field, the resolved value, and its provenance scope (`Sourced.source`).
   - Enables in-browser editing of settable machine-specific parameters (`setInstanceAttribute`).
4. **Test Verification (`test/policy.test.ts` & `test/policy-store.test.ts`):**
   - 456 lines in `test/policy.test.ts` verifying cascade ordering and explanations.
   - 140 lines in `test/policy-store.test.ts` verifying persistence roundtrips.

---

### 4.2 Relocated and Generalized JSON Extraction Subsystem

#### Prose Claim in Documentation
In `postmortems/2026-08-30_session_heylook-provider.md` (lines 19, 56–57), the JSON extraction module is cited as:
> *"`src/provider/heylook/json.ts` took the first parseable object rather than the longest, so a preamble mentioning `{}` returned valid JSON that was the wrong object."*

#### Ground-Truth Code Implementation
The module `src/provider/heylook/json.ts` no longer exists. It was relocated and generalized into `src/provider/shape.ts` (lines 1–294) to serve as a shared, provider-agnostic extraction layer.

- **Load-Bearing Architectural Rationale (`src/provider/shape.ts:1–36`):**
  Schema enforcement is a per-call option (`CallOptions.enforceSchema`), not a provider property. With `ENFORCE_SCHEMA_DEFAULT = false`, both Gemini and heylook run unconstrained to preserve creative prose quality. Therefore, unconstrained extraction logic must reside at the root of `src/provider/` rather than inside `heylook/`.
- **Key Exported Symbols:**
  - `ENFORCE_SCHEMA_DEFAULT`: `false` (lines 84–87).
  - `withShapeTrailer(systemInstruction, schema)` (lines 90–96): Appends `# Output format` JSON Schema to system prompt.
  - `extractJsonObject(text, expectedKeys)` (lines 141–187): Multi-pass resilient JSON parser using balanced brace scanning (`balancedObjectAt`) and key resemblance scoring (`resemblance`) to defeat preamble and schema-echo traps.

---

## 5. Metrics, Versioning & Repository Metadata Divergences

### 5.1 Test Suite Counts Discrepancy

Documentation across the repository carries conflicting and obsolete test counts:

```
Historical Test Count Timeline in Documentation:
Session 1 Postmortem (2026-08-28):   544 tests (range ba179c0..a95ae8c)
Session 2 Postmortem (2026-08-30):   593 tests (commit 10ae5f2)
Session 3 Postmortem (2026-08-31):   682 tests -> 700 tests (commit b61cc28)
README.md (line 214):                719 tests
CLAUDE.md (line 77):                 888 tests (vitest)
─────────────────────────────────────────────────────────────────────────────
Ground Truth Execution (2026-09-03): 921 tests across 28 test suites
                                     (915 pass, 6 fail, 3,479 expect() calls)
```

#### Ground-Truth Execution Output
Running `bun test` / `vitest run` on the repository yields:
- **Test Files:** 28 test files in `test/`
- **Total Tests:** 921 tests
- **Passing:** 915 tests
- **Failing:** 6 tests (all 6 attributable to Discrepancy D-01)
- **Assertions:** 3,479 `expect()` checks

---

### 5.2 Package Version Number Mismatch

#### Prose & Changelog Claims
- **`CHANGELOG.md` (line 476):** Formally documents release `## [0.3.0]`, alongside entries for `[0.2.1]`, `[0.2.0]`, and `[0.1.0]`.
- **`postmortems/2026-08-28_session_glitch-wildcards-contract.md` (forward item 5):**
  > *"Reconcile `package.json` version 0.1.0 with CHANGELOG's `[0.3.0]`. Raised during the session and never answered; there are no git tags. Done when the two agree or the mismatch is recorded as intentional."*

#### Ground-Truth Code Manifest
- **`package.json` (line 4):**
  ```json
  {
    "name": "h3-transformation-engine",
    "private": true,
    "version": "0.1.0",
    ...
  }
  ```
The version number in `package.json` was never incremented from `0.1.0` and has drifted across multiple releases documented in `CHANGELOG.md`.

---

## 6. Format, Syntax & Vocabulary Divergences

### 6.1 Alignment Line Syntax Divergence: FL2VA Bare vs. L2VA Bracketed Format

#### Nature of Discrepancy
A common assumption when interacting with the MiniMax reference format is that alignment lines follow a uniform bracketed syntax across all image reference modes (e.g. `<Picture 1>` and `[Shot 1]`). However, the official vendor specifications and the codebase implement a strict structural divergence between `FL2VA` and `L2VA`.

#### Ground-Truth Code Implementation
- **`src/core/ir/vocab.ts` (`ALIGNMENT_TEMPLATES`, lines 56–73):**
  ```ts
  export const ALIGNMENT_TEMPLATES = {
    T2VA: null,

    I2VA:
      'For the target video, at 0.00 seconds into the target video, ' +
      '<Picture 1> (from [Shot 1]) is fully referenced.',

    FL2VA:
      'How the reference pictures align with the target video — ' +
      'Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; ' +
      'Picture 2 (from Shot {N}) aligns with the {S.SS}-second mark of the target video.',

    L2VA:
      'How the reference pictures align with the target video — ' +
      '<Picture 1> (from [Shot {N}]) aligns with the {S.SS}-second mark of the target video.',

    Ref2VA: null,
  } as const satisfies Record<H3Mode, string | null>;
  ```

#### Detailed Syntax Comparison
| Mode | Em Dash Prefix | Angle Brackets on Picture | Square Brackets on Shot | Second-Mark Suffix |
|---|---|---|---|---|
| **`I2VA`** | No (`For the target video, at 0.00 seconds...`) | **Yes** (`<Picture 1>`) | **Yes** (`[Shot 1]`) | N/A (`is fully referenced.`) |
| **`FL2VA`** | **Yes** (`How the reference pictures align... — `) | **No** (`Picture 1`, `Picture 2`) | **No** (`Shot 1`, `Shot {N}`) | `; Picture 2 ... aligns with {S.SS}-second mark` |
| **`L2VA`** | **Yes** (`How the reference pictures align... — `) | **Yes** (`<Picture 1>`) | **Yes** (`[Shot {N}]`) | `aligns with the {S.SS}-second mark of the target video.` |

#### Vendor Guide Citations
- **`reference/h3/VIDEO_PROMPT_WRITING_GUIDE_base_en.md` (lines 25, 31, 201, 215):**
  - Line 25 (FL2VA Specification): `Picture 1 (from Shot 1)` (bare).
  - Line 31 (L2VA Specification): `<Picture 1> (from [Shot N])` (bracketed).
  - Line 201 (Base Guide Case 3 Worked Example): Reproduces bare format verbatim.
  - Line 215 (Base Guide Case 4 Worked Example): Reproduces bracketed format verbatim.
- **`CLAUDE.md` (line 70):**
  Explicitly warns: *"Notably: citing `<Picture N>`/`<Audio N>` inside the timeline is correct... and the FL2VA alignment line is bare, not bracketed."*

---

### 6.2 Purged Budget Exports & Warning Severity Elimination

#### Historical Prose Claims
Early architecture discussions and design notes in `postmortems/` referenced budgeting functions for shot length and word counts, including `MIN_SHOT_MS`, `comfortableLatestCutMs`, `countWords`, and `countSentences`. Historical validator notes also discussed "warning" severities for non-fatal pacing issues.

#### Ground-Truth Code Implementation
- **`src/core/normalize/budgets.ts` (lines 79–86):**
  ```ts
  // Four exports were removed from here: `MIN_SHOT_MS`, `comfortableLatestCutMs`,
  // `countWords` and `countSentences`. None had a caller anywhere outside this
  // file. `comfortableLatestCutMs` also carried the last written trace of the
  // warning severity the validator retired -- "crossing this is a warning, not an
  // error" -- which is a rule the repo removed documented as if it were live. The
  // sentence ranges it would have checked reach the planner prompt as advice and
  // no rule counts them, so nothing was quietly relying on any of it.
  ```
- **`src/core/validate/types.ts` (lines 1–35):**
  The validator engine defines only `Diagnostic = { code: string; path: string; message: string }`. There is zero `severity` field and no concept of `warning`.
- **`CLAUDE.md` (lines 22–23):**
  *"Errors only in the validator. There is no warning severity, and it should not come back. A diagnostic means the document is provably malformed. Anything that pattern-matches prose for a preference belongs in the planner prompt, not in `validate/`. Seventeen such rules were removed after they fired on legitimate output."*

---

## 7. Historical Postmortem Traps vs. Implemented Code Invariants

Across the four postmortem debugging sessions (`postmortems/`) and standing rules in `CLAUDE.md`, numerous engineering traps were identified. Below is the comprehensive catalog of these traps and the exact invariants in `src/` and `test/` that resolve them.

### 7.1 Traps from Session 1 (2026-08-28: Glitch, Wildcards, Contract)

#### Trap 1: Typographic Apostrophe Drift in Golden Fixtures
- **Postmortem Observation:** Golden test fixtures for `T2VA` and `Ref2VA` had drifted by 13 typographic apostrophes (`’`, U+2019) instead of ASCII single quotes (`'`, U+0027). Tests passed byte-exact because they checked against an already corrupted local copy.
- **Code Invariant:** `test/guide-fidelity.test.ts` (lines 31–72) enforces that all golden fixtures in `src/core/ir/examples.ts` match the official guides character-for-character and contain zero non-ASCII characters (except the em dash `—` U+2014 in FL2VA/L2VA alignment lines).

#### Trap 2: Glitch Off Button Mode Hijacking
- **Postmortem Observation:** Clicking "Off" in `CreativePanel` returned a `CreativeModeRecord`. Because the record required a mode, it forced `mode: 'directed'`, turning the Directed button back on and preventing the user from disabling creative direction while marks existed.
- **Code Invariant:** `src/core/creative/resolver.ts` (lines 98–132) and `src/ui/CreativePanel/CreativePanel.tsx` decouple mark retention from mode selection. Functions `hasDirection`, `sameRecord`, `describeRecord`, and `pruneRecord` evaluate both halves independently.

#### Trap 3: Prototype Pollution via `{constructor}` in Wildcard Matrix
- **Postmortem Observation:** When expanding wildcard matrices, input `{constructor}` resolved to `Object.prototype.constructor`, polluting matrix rows and bypassing placeholder filters.
- **Code Invariant:** `src/core/wildcards/matrix.ts` (lines 54–58) initializes cartesian accumulation dictionaries using `Object.create(null)` to eliminate prototype inheritance.

#### Trap 4: Creative Mode and Roll Stamping Placement
- **Postmortem Observation:** Stamping `creativeMode` and wildcard `roll` on documents was placed in `compile()` after the model call, leaving it unreachable by unit tests.
- **Code Invariant:** Stamping was relocated to pure function `assemble()` in `src/core/assemble.ts` (lines 241–255), allowing direct verification without network mocking.

#### Trap 5: Timestamp Patchability Invariant
- **Postmortem Observation:** `VISION.md` claimed timestamps were immutable by construction. In reality, timestamps are mutable editorial values.
- **Code Invariant:** `shots[].cutAtMs` is explicitly included on the allowlist `PATCHABLE_LEAVES` in `src/core/ir/paths.ts` (lines 115–135), guarded by Gate 4 schema validation.

#### Trap 6: Ref2VA Dual-Label Retention Collision
- **Postmortem Observation:** A video slot with both video and audio roles receives two labels: `<Video N>` and `<Audio M>`. Keying retention coverage by slot ID instead of label caused one retention entry to overwrite or shadow the other.
- **Code Invariant:** `src/core/normalize/labels.ts` (lines 55–75) and `src/core/serialize/ref2va.ts` (lines 104–125) key retention coverage strictly by `SlotLabel.ref`, asserted by `test/ref2va-labels.test.ts`.

---

### 7.2 Traps from Session 2 (2026-08-30: heylook Provider)

#### Trap 7: Non-Streaming Abort Queue Blocking
- **Postmortem Observation:** Calling `AbortController.abort()` on a non-streaming `fetch` ended client wait time but left the local heylook server executing the request in the background for over 57 seconds.
- **Code Invariant:** `src/provider/heylook/client.ts` (lines 471–501) generates a unique `X-Request-ID` and issues an explicit `DELETE /v1/requests/{requestId}` call upon abort, immediately terminating server-side generation.

#### Trap 8: `retryAfterMs` Fallthrough on Negative Values
- **Postmortem Observation:** Heylook returned `Retry-After: -1` on refusal. Falling through numeric checks to `Date.parse("-1")` interpreted `-1` as a year, resulting in a zero-millisecond wait loop.
- **Code Invariant:** `src/provider/heylook/client.ts` (lines 701–716) strictly validates numeric `Retry-After` headers, ignoring non-positive values and falling back to exponential backoff (`DEFAULT_RETRY_MS = 2000`).

#### Trap 9: `extractJsonObject` First-Match and Longest-Match Traps
- **Postmortem Observation:** Naive JSON extraction picked the first `{}` (matching preamble notes) or the longest match (echoing the prompt's 13KB schema definition).
- **Code Invariant:** `src/provider/shape.ts` (lines 141–187) scores balanced JSON candidates by top-level key resemblance (`requiredKeys`) matching the target Zod schema.

#### Trap 10: Capability Gating vs. Modality Advertising
- **Postmortem Observation:** Checkpoint configurations advertised `modalities: ['vision']`, but the server's MLX loader stripped vision towers, causing unexpected 400 errors.
- **Code Invariant:** `src/provider/heylook/models.ts` (lines 141–145) gates image inputs strictly against runtime `capabilities` (`capabilities.includes('vision')`), ignoring `modalities`.

#### Trap 11: Shape Trailer Invisibility to Contract Tests
- **Postmortem Observation:** Deleting the JSON shape trailer broke model output but left all contract tests green because `test/contract.test.ts` checked only prompt builder outputs.
- **Code Invariant:** `test/heylook.test.ts` verifies shape trailer injection on the actual wire payload downstream of the prompt builder.

#### Trap 12: Empty Subject Sources Schema Violation
- **Postmortem Observation:** An early prompt revision instructed the model to emit empty `sources: []` on subjects for base modes, violating Zod's `min(1)` requirement.
- **Code Invariant:** `src/provider/prompts/planner.ts` (lines 285–300) keys subject generation instructions strictly to Ref2VA mode, omitting subject generation on base modes.

---

### 7.3 Traps from Session 3 (2026-08-31: Debug Console & Telemetry)

#### Trap 13: Version ID Collision on Page Reload
- **Postmortem Observation:** A module-level counter `let nextId = 1` reset to 1 on every browser reload, generating `workspace:v0001` and overwriting prior root versions in IndexedDB.
- **Code Invariant:** `src/db/versions.ts` (lines 52–98) queries the highest existing numeric suffix (`highestSuffix`) directly from the IndexedDB `versions` store inside the write transaction before allocating the next version key.

#### Trap 14: Parent Cycles in Version Trees
- **Postmortem Observation:** Historical version overwrites caused records where `parentId === id` or cyclic ancestor chains, crashing depth-first tree traversal.
- **Code Invariant:** `src/db/versions.ts` (lines 146–157) implements cycle detection (`inCycle`). Any node found in a cycle is detached and hoisted to the root level as an orphan.

#### Trap 15: Storage Telemetry Crash on Partial Records
- **Postmortem Observation:** Emitting telemetry in `src/db/db.ts` read `record.doc.shots.length` unconditionally, crashing unit test suites that saved partial document fixtures.
- **Code Invariant:** Defensive accessors with safe defaults (`record.doc?.shots?.length ?? 0`) were added across all event emitters in `src/db/db.ts` and `src/debug/redact.ts`.

#### Trap 16: Oversized Telemetry Event Eviction
- **Postmortem Observation:** Emitting a single payload larger than 500KB evicted the entire 4MB memory event bus history.
- **Code Invariant:** `src/debug/bus.ts` (lines 125–160) enforces `MAX_EVENT_BYTES = 500,000`. Payloads exceeding this threshold are replaced with a capped summary object preserving up to 32 key names.

---

### 7.4 Traps from Session 4 (2026-09-01: Conformance Harness & Local Models)

#### Trap 17: Negative Assertions Blind to Reworded Defects
- **Postmortem Observation:** Tests using `expect(prompt).not.toContain(badString)` passed when a prompt author reworded the defect into a different phrasing.
- **Code Invariant:** Tests in `test/creative-integration.test.ts` were converted into composition checks asserting exact whole-string equality (`styledPrompt === barePrompt + derivedDirective`).

#### Trap 18: Conformance Stage Separation
- **Postmortem Observation:** Aggregating model runs into a single pass/fail metric masked whether a failure was caused by server network timeout, schema invalidity, or semantic validator rejection.
- **Code Invariant:** `scripts/conformance-heylook.mjs` classifies every model execution into distinct orthogonal columns: `provider`, `schema`, `assembly`, `diagnostics`, and `clean`.

#### Trap 19: Thinking Model Separation
- **Postmortem Observation:** Thinking models emitted chain-of-thought tokens inside the same text channel as the JSON document, corrupting JSON parsers.
- **Code Invariant:** `src/provider/heylook/client.ts` (lines 607–623) joins only content blocks where `type === 'text'`, discarding `type === 'thinking'` blocks prior to extraction.

---

### 7.5 Standing Invariants Recorded in CLAUDE.md

#### Trap 20: Gemini Thinking Level Minimal 400 Rejection
- **Code Invariant:** `src/provider/gemini.ts` (lines 53–70) narrows `ThinkingLevel` to `'low' | 'medium' | 'high'`, banning `'minimal'` which triggers HTTP 400 on `gemini-3.7-flash`.

#### Trap 21: Database Dynamic Schema Healing
- **Code Invariant:** `src/db/db.ts` (lines 118–142, `openHealed`) and `src/crypto/secureStore.ts` (lines 114–121, `vault`) never call `openDB(name, 1)`. They open versionless, inspect store and index existence, and bump version dynamically to upgrade without destroying user data.

#### Trap 22: Device Key Mode Decrypt-Only
- **Code Invariant:** `src/crypto/secureStore.ts` (lines 60, 222–225) defines `WritableKeyMode = 'origin' | 'passphrase'`, strictly excluding `'device'`. Attempting to write a device key throws an error at runtime.

#### Trap 23: Scope-Bounded Ref2VA Word Budget
- **Code Invariant:** `src/core/ir/vocab.ts` (line 341) and `test/guide-fidelity.test.ts` (lines 75–115) bind the 350–500 word range strictly to generation tasks, explicitly exempting video-editing and dialogue-dense clips.

#### Trap 24: Temperature Policy & Owner Ruling
- **Code Invariant:** `src/provider/gemini.ts` (lines 111–155) and `src/provider/heylook/client.ts` (line 182) omit `temperature` from request payloads. The owner's ruling prohibits deterministic sampling and temperatures below 1.0.

---

## 8. Actionable Remediation & Synchronization Plan

To align documentation and tests with the active codebase while maintaining code as ground truth, the following remediation tasks are recommended for subsequent project phases:

1. **Reconcile Recognisable People Rule (Discrepancy D-01):**
   - *Option A (Code is Ground Truth):* Update `test/creative-integration.test.ts` and `test/contract.test.ts` to remove assertions requiring `# Recognisable people`, and update `README.md` and `contract.json` to record the deletion made in commits `9b39c6a` and `71d5362`. This restores the test suite to 100% green (921/921 tests passing).
   - *Option B (Restore Rule to Code):* If the deletion in commits `9b39c6a` and `71d5362` was accidental or experimental, restore the prompt blocks in `src/provider/prompts/planner.ts` and `patch.ts`.
2. **Document Operational Policy Subsystem (Discrepancy D-02):**
   - Update `README.md` (§ Layout and § Architecture) to include `src/core/policy/`, `src/db/policy.ts`, and `src/ui/PolicyPanel.tsx`. Create dedicated wiki documentation article `wiki/policy.md`.
3. **Synchronize Test Counts Across Documentation (Discrepancy D-03):**
   - Update `CLAUDE.md:77` (from 888 to 921 tests) and `README.md:214` (from 719 to 921 tests).
4. **Bump Version in `package.json` (Discrepancy D-04):**
   - Increment `package.json` version from `"0.1.0"` to `"0.3.0"` to match `CHANGELOG.md`.
5. **Update Historical Path References (Discrepancy D-05):**
   - Add a footnote in `postmortems/2026-08-30_session_heylook-provider.md` noting that `src/provider/heylook/json.ts` was relocated to `src/provider/shape.ts`.
6. **Cross-Link Wiki Articles:**
   - Link all discrepancy entries from `wiki/index.md` and subsystem reference articles.

---

## Related Articles

- [← Back to Master Navigation Index](index.md)
