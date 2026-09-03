# H3 Transformation Engine Knowledge Base

Welcome to the comprehensive technical documentation and architecture manual for the **H3 Transformation Engine**. This wiki provides an exhaustive, ground-truth reference for human engineers and autonomous agents covering the system's architecture, pure computational kernel, compiler pipeline, diagnostic rules, serialization formats, security models, and lessons learned.

---

## System Overview

The **H3 Transformation Engine** is a deterministic prompt compiler and structured intermediate representation (IR) editor tailored for MiniMax H3 video generation models (`T2VA`, `I2VA`, `FL2VA`, `L2VA`, and `Ref2VA`).

The engine is **strictly a prompt-only compilation and editorial tool**:
- It produces byte-exact, specification-compliant multimodal conditioning prompts and character-level source maps.
- It **does not** call video generation APIs, run diffusion weights, or render video frames.
- It translates human or programmatic intent into structured documents (`H3Document`), executes strict AST validation across 29 discrete rules, supports surgical path-based patching, and deterministically serializes output prompts.

```
Compilation Pipeline:
CompileInput ───► normalize() ───► InferenceClient.call() ───► assemble() ───► validate() ───► serialize() ───► Prompt + SourceMap
                         │                                                   ▲
                         ▼                                                   │
                  NormalizedContext                                   [Optional Patch]
                                                                     (applyPatch / editDirect)
```

---

## Master Article Directory

The knowledge base is structured into dedicated topic guides:

### Core Architecture & Compiler Pipeline
- **[Architecture & Pipeline Overview](architecture.md)**
  High-level architectural design, pure TypeScript kernel boundary, execution stages (`normalize` $\rightarrow$ `plan` $\rightarrow$ `assemble` $\rightarrow$ `validate` $\rightarrow$ `patch` $\rightarrow$ `serialize`), 24 FPS timing models, and data flow.
- **[Invariants & Engineering Rules](invariants.md)**
  The two foundational invariants (*Beats carry prose*, *Prompt text is a pure function of the document*), strict purity guarantees (`test/purity.test.ts`), diagnostic control rules, derived string invariants, and provider constraints.
- **[Intermediate Representation (IR) & Schemas](core_ir.md)**
  Canonical document AST (`H3Document`), Zod schemas (`H3DocumentSchema`, `PlannerOutputSchema`, `PatchOutputSchema`), path addressing mechanics, all 19 `PATCHABLE_LEAVES`, and closed vocabularies (`vocab.ts`).
- **[Deterministic Normalization Subsystem](core_normalize.md)**
  Pre-inference computation, 24 FPS $17k+5$ frame grid math, independent label assignment counters, video dual-labeling, advisory mode inference, and pacing budgets.
- **[Validation Engine & Complete Diagnostic Catalog](core_validate.md)**
  Exhaustive catalog of all 29 rules across timeline, speech, and sections; all 36 diagnostic codes with trigger conditions; red-proving test fixtures and cry-wolf protection (`test/validate.test.ts`).
- **[Serialization Engine & Reference Guide Fidelity](core_serialize.md)**
  Base mode (`serializeBase`) vs. Ref2VA mode (`serializeRef2va`), alignment line templates, `Emitter` source mapping, character-level click-to-fix tracking, and byte-exact fidelity with official MiniMax guides.
- **[Patch Subsystem & Surgical Modification](core_patch.md)**
  Surgical AST mutation, 4-gate verification in `applyPatch`, user-supplied dialogue protection, and immutable structural sharing via `setAtPath`.

### Creative Systems & Extensions
- **[Creative Engine, Visual Packs & Anchors](core_creative.md)**
  Curated style packs across 4 families (27 visual medium `V01`–`V27`, 8 motion behavior `M01`–`M08`, 9 finish `F01`–`F09`, 9 audio `A01`–`A09`), 30 style reference anchors (`R01`–`R30`), 5 leverage axes (`G`, `S`, `P`, `M`, `T`), and stress-test leverage scoring.
- **[Glitch Marks Subsystem](glitch_marks.md)**
  Tokenizer anomaly strings ("SolidGoldMagikarp" family, 10 tokens), 6 physical surfaces, placement invariants, and mode-dependent restrictions.
- **[Wildcards & Permutation Matrix](wildcards.md)**
  Dynamic prompt variation across 12 categories and 122 curated values, seeded PRNG (`mulberry32`), and Cartesian experiment matrices capped at 64 combinations.

### Runtime, Storage, Infrastructure & UI
- **[Provider Layer & Client Abstractions](provider.md)**
  The `InferenceClient` abstraction, Google Gemini Interactions API client, local heylook Anthropic Messages API client, retry policies, cancellation handling, and JSON schema extraction trailers.
- **[Crypto & Secure Storage](crypto.md)**
  Client-side AES-GCM-256 and PBKDF2 encryption ("H3KeyVault"), key modes (`origin`, `passphrase`, `device`), and non-extractable CryptoKey management.
- **[Database Architecture & Version Lifecycle](db.md)**
  IndexedDB persistence ("H3TransformationEngine"), dynamic versionless schema repair (`openHealed`), immutable version trees with parent pointers, and survey-erase-survey wipe routines.
- **[Telemetry & Debug Console](debug.md)**
  In-memory bounded circular event bus across 4 channels (`provider`, `pipeline`, `state`, `storage`), automatic PII/secret redaction, and UI debug console.
- **[UI Component Hierarchy & State Management](ui.md)**
  React component layout, `useEngine` state hook, single-flight serial operation queue (`createSerialQueue`), document editor, and live preview.
- **[Operational Policy Engine](policy.md)**
  Hierarchical policy cascade (`global` $\rightarrow$ `provider_type` $\rightarrow$ `instance` $\rightarrow$ `model`), concurrency budgets, and UI policy panel.

### Audits, Verification & Postmortems
- **[Code-Documentation Discrepancy Ledger](code_doc_discrepancies.md)**
  Exhaustive line-by-line audit documenting all divergences between prose documentation (`CLAUDE.md`, `README.md`, `VISION.md`, `PLAN.md`, `contract.json`) and TypeScript ground truth in `src/`.
- **[Test Infrastructure & Verification Harness](verification_harness.md)**
  Architecture and specification of the 4-tier automated verification runner (`verify.ts`), CLI options, and diagnostic troubleshooting.
- **[Consolidated Engineering Postmortems & Lessons](postmortems_lessons.md)**
  Synthesis of historical debugging sessions (2026-08-28 through 2026-09-01), subtle traps, false-green testing hazards, and lessons learned.

---

## Subsystem Architecture Matrix

| Layer | Subsystem Path | Purity Boundary | Primary Responsibilities |
|---|---|---|---|
| **Kernel** | `src/core/ir/` | Pure TS | Canonical document AST, Zod schemas, path syntax, closed vocabularies |
| **Kernel** | `src/core/normalize/` | Pure TS | Duration arithmetic, frame grid snapping, label counting, mode inference |
| **Kernel** | `src/core/validate/` | Pure TS | 29 validation rules, 36 diagnostic codes, total rule isolation |
| **Kernel** | `src/core/serialize/` | Pure TS | Deterministic prompt text emission, character-level source mapping |
| **Kernel** | `src/core/patch/` | Pure TS | Path-targeted AST mutation, 4-gate verification, dialogue protection |
| **Kernel** | `src/core/creative/` | Pure TS | Visual packs, reference anchors, strength axes, glitch mark definitions |
| **Kernel** | `src/core/wildcards/` | Pure TS | Seeded PRNG expansion, Cartesian experiment matrix generation |
| **Kernel** | `src/core/policy/` | Pure TS | Hierarchical execution policies, concurrency, backpressure budgets |
| **Transport** | `src/provider/` | Impure (Network) | Gemini and heylook wire formatting, schema trailers, defensive JSON parsing |
| **Storage** | `src/crypto/` | Impure (WebCrypto) | Non-extractable AES-GCM and PBKDF2 API key vaults in IndexedDB/localStorage |
| **Storage** | `src/db/` | Impure (IndexedDB) | Document persistence, version tree branching, versionless schema healing |
| **Telemetry** | `src/debug/` | Impure (Memory) | Bounded circular event bus (800 events / 4MB), redaction, debug console |
| **UI** | `src/ui/` | Impure (React/DOM) | Interactive workbench, slot manager, prompt viewer, timeline visualizer |

---

## Quick Start & Verification

### Running the Test Suite
The repository uses Vitest for unit, integration, fidelity, and purity testing:

```bash
# Run all 921 test cases across 28 test files
bun run test

# Run the strict purity boundary test for src/core/
bun run test test/purity.test.ts

# Run the validation diagnostic control suite
bun run test test/validate.test.ts

# Run the MiniMax reference guide byte-exact fidelity suite
bun run test test/guide-fidelity.test.ts
```

### Running Typechecks
TypeScript static analysis is configured under `tsconfig.json`:

```bash
# Verify type safety across the entire repository
bun run typecheck
```

### Running Wiki Knowledge Base Verification
The automated verification harness (`wiki/verify.ts`) tests link integrity, heading anchor validity, and symbol correspondence:

```bash
# Run full 4-tier verification on wiki documentation
bun run wiki/verify.ts

# Run without executing long-running test suites
bun run wiki/verify.ts --skip-tier4
```
