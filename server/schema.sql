-- The SQLite schema.
--
-- Two halves with different shapes, joined on document and version id.
--
-- The LIBRARY is a document store: identity, lineage and timestamps are columns,
-- the H3 document itself is one JSON body. It is read whole and written whole,
-- and `H3DocumentSchema` in src/core/ir/schema.ts already owns its shape, so
-- shredding it into tables would be a second source of truth for a graph of a
-- dozen entity types that moves whenever the document model moves. Measured, on
-- a synthetic corpus in the real document shape: loading one whole document is
-- 0.004ms from a JSON body against 0.013ms reassembled from normalised tables,
-- and loading one document is what this app does constantly.
--
-- More decisive than the speed: shredding breaks reports-does-not-gate.
-- `loadDocument` returns a record together with `schemaError` so a build never
-- refuses to open what the previous build wrote, and relational columns turn
-- that warning into an insert failure.
--
-- The MEASUREMENT half is a wide append-only fact table. It is the reason this
-- move is worth making: nothing today records which prompt, model or settings
-- produced a document, so the question CLAUDE.md names as the main open one --
-- whether the prose conditions H3 well -- is not answerable retroactively.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;      -- per connection, and OFF by default in SQLite

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  body            TEXT NOT NULL CHECK (json_valid(body)),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  -- Soft delete, because deleteDocument cascades versions away irreversibly and
  -- a solo tool has no other undo. The erase button still hard-deletes.
  deleted_at      INTEGER,
  head_version_id TEXT,

  -- The idea that produced this document, EXPANDED -- what the planner actually
  -- received, not the template it was written as.
  --
  -- Without it a document cannot be regenerated, which CLAUDE.md carries as open
  -- work and `types.ts` states in the `roll` comment: "the template it was a seed
  -- of lives in the idea box, which nothing persists". `doc.roll` is not a
  -- substitute -- it holds the template and seed, and only when wildcards were
  -- used, so a plainly typed idea leaves nothing behind at all.
  --
  -- Expanded rather than templated because that is what conditions the model:
  -- `CompileInput.idea` arrives at `compile` already expanded, and `roll` is the
  -- record of how. Store both and you have the whole story; store the template
  -- alone and you have nothing in the common case.
  --
  -- Stored like `title` and for the same reason: the body has no idea field, and
  -- adding one would be contract-adjacent.
  idea            TEXT NOT NULL DEFAULT '',

  -- Stored, not generated. `title` is an app-level name that lives on the
  -- StoredDocument wrapper and is set from the save label -- `H3Document` has no
  -- title field, so a column generated from `body ->> '$.title'` is NULL for
  -- every row. It was written that way here and shipped, because the test
  -- asserting it compared the column to the fixture's own missing property and
  -- so compared null to null. A null result establishes nothing unless you know
  -- the check could have matched.
  title           TEXT NOT NULL DEFAULT '',

  -- Projected from the body so the list view never parses JSON it does not need.
  -- These two ARE functions of the body, which is what makes them safe to derive.
  -- VIRTUAL rather than STORED, for two measured reasons: an indexed VIRTUAL
  -- column beat an unindexed STORED one by 27x at 20k rows, and ALTER TABLE ADD
  -- COLUMN ... STORED is rejected outright on a populated table while VIRTUAL is
  -- accepted. So VIRTUAL is both faster where it matters and the only kind that
  -- can be added later.
  mode            TEXT    GENERATED ALWAYS AS (body ->> '$.mode') VIRTUAL,
  shot_count      INTEGER GENERATED ALWAYS AS (json_array_length(body, '$.shots')) VIRTUAL
) STRICT;

-- Covering: the list view reads title, mode and shot_count, and without them in
-- the index every row re-parses its body. Measured 0.241ms -> 0.014ms.
CREATE INDEX IF NOT EXISTS documents_list
  ON documents (updated_at DESC, title, mode, shot_count)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS documents_mode ON documents (mode);
CREATE INDEX IF NOT EXISTS documents_shot_count ON documents (shot_count);

-- Full snapshots, not deltas. Size is the smaller argument -- 2000 documents at
-- four versions each measured 48 MiB against 7.5 MiB of documents, which is
-- nothing for a solo tool. The real reason is that a delta chain is only as good
-- as its ancestry: one missing link loses everything downstream, while a
-- snapshot is independently openable. That is the same posture every load
-- boundary here takes, where what the previous build wrote must still open.
CREATE TABLE IF NOT EXISTS versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES versions (id),
  -- Alongside parent_id, because "every version of this document" is otherwise a
  -- recursive CTE you write fifty times. Lineage still walks parent_id.
  root_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  label       TEXT NOT NULL,
  body        TEXT NOT NULL CHECK (json_valid(body)),
  operations  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(operations))
) STRICT;

CREATE INDEX IF NOT EXISTS versions_document ON versions (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS versions_root ON versions (root_id);

-- ---------------------------------------------------------------------------
-- Measurement
-- ---------------------------------------------------------------------------

-- An experiment is a question; an arm is one configuration being compared.
--
-- This exists because the unit of comparison is a DISTRIBUTION, not a call.
-- PLAN.md records that a fixed seed does not reproduce -- the same idea and seed
-- gave a schema refusal in one run and a clean document in the next -- so every
-- comparison is between distributions and n per arm has to be recoverable. A
-- table of calls with no arm key can hold every call ever made and still not
-- answer "did thinking-on improve conformance", because nothing says which
-- calls constitute one arm.
CREATE TABLE IF NOT EXISTS experiments (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  question   TEXT NOT NULL,
  notes      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS arms (
  id            TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments (id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  created_at    INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS arms_experiment ON arms (experiment_id);

-- One row per thing the pipeline asked for -- CALL grain, not request grain.
--
-- One call can be several HTTP requests when heylook is busy, so the two are
-- different grains and the schema says which it means. `attempts` and
-- `queued_ms` carry the retry story in aggregate; a run_attempts child table is
-- purely additive if per-request detail is ever wanted.
CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,

  -- Null for a harness call that never became a document.
  --
  -- Deliberately carrying NO foreign key, unlike everything else in this file.
  -- A measurement record has to outlive the artifact it measured: the erase
  -- button hard-deletes and `versions` cascades, so an FK here would either
  -- delete the evidence with the document or null the id and lose the ability to
  -- group a document's runs after the fact. The id is kept as a plain value on
  -- purpose. Stated because four FKs are present nearby and the next reader
  -- would otherwise read this as an omission.
  document_id    TEXT,
  version_id     TEXT,
  arm_id         TEXT REFERENCES arms (id) ON DELETE SET NULL,

  role           TEXT NOT NULL,          -- planner | patch | analysis roles
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  instance_id    TEXT,

  -- The values that went on the wire, not the settings that were in force:
  -- they differ whenever the server's own cascade fills something in.
  task           TEXT,
  -- `auto` is not a synonym for off: it omits the field entirely and lets the
  -- server's own cascade decide, so it has to be recordable as its own value.
  thinking       TEXT CHECK (thinking IS NULL OR thinking IN ('auto', 'on', 'off')),
  -- heylook's `reasoning_effort`, a separate axis from `thinking` and only sent
  -- with thinking on. Deliberately unconstrained, for the same reason
  -- `failure_cause` is: its vocabulary is per model, so a closed set here would
  -- make a legal value unrecordable the first time a new model is served.
  effort         TEXT,
  enforce_schema INTEGER,
  creative_mode  TEXT CHECK (creative_mode IS NULL OR json_valid(creative_mode)),

  -- The stage the call reached. The conformance harness's own vocabulary, and
  -- the stages are separate columns of an analysis, never summed: a model that
  -- reaches `diagnostics` held the shape and one that stopped at `schema` did
  -- not.
  stage          TEXT NOT NULL CHECK (stage IN (
                   'provider', 'no_json', 'truncated', 'schema',
                   'assembly', 'diagnostics', 'clean')),
  -- The specific field or rule that failed, from the harness's cause list.
  -- Free text is deliberate here and only here: the cause set grows with every
  -- new failure seen, and pinning it would make an unseen cause unrecordable.
  failure_cause  TEXT,
  -- What a reader saw that no diagnostic can name -- ambience filed as music, a
  -- cut-off line with no tag that validates clean. Distinct from `stage`, which
  -- is mechanical.
  reader_note    TEXT,

  duration_ms    INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 1,
  queued_ms      INTEGER,
  prompt_tokens  INTEGER,
  output_tokens  INTEGER,

  -- Hash what was SENT, not what the builder returned: the heylook client
  -- appends the JSON schema to the system prompt after buildPlannerSystemPrompt
  -- has returned, so the two are different strings.
  prompt_sha256  TEXT,
  -- The model's reply before parsing. Not reconstructable after the fact, and it
  -- is the input to any later grading, which is why it is kept at all.
  --
  -- Two consequences to expect rather than discover. It is large, so it will
  -- dominate this table the way version bodies dominate `documents` -- measured
  -- there at roughly 4:1. And it is a fourth thing `src/db/wipe.ts` has to
  -- survey: that button re-reads counts after deleting and can return
  -- `clean: false` on purpose, so a store it does not know about is a store it
  -- reports as erased while the prompts are still on disk.
  raw_output     TEXT,

  -- Which build and which prompt contract produced this, so a run recorded
  -- against an older prompt is identifiable rather than silently comparable --
  -- the misquotation class, applied to a measurement instead of a number.
  --
  -- `contract_json_sha` names its file on purpose. The obvious reading of a
  -- bare `contract_sha` is one of `contract.sources[].sha256`, and those pin the
  -- two MiniMax GUIDE files rather than the spec: they are load-bearing for
  -- guide fidelity, they essentially never change, and a run tagged with one
  -- would say which vendor guide was on disk, which is not the question. What
  -- groups runs is which generation of the prompt spec produced them, so this is
  -- the hash of reference/h3/contract.json itself. Its `version` field is the
  -- weaker alternative -- 1.0.0 today, and not bumped per prompt edit. The hash
  -- transitively covers the guides anyway, since their shas are inside the file.
  --
  -- It earns its place beside `prompt_sha256` rather than instead of it: the
  -- per-call hash says two runs sent identical bytes, this says two runs belong
  -- to one generation of the spec even when their prompts legitimately differ by
  -- mode or creative record.
  app_version       TEXT,
  contract_json_sha TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS runs_arm ON runs (arm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_model ON runs (provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_document ON runs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS runs_stage ON runs (stage);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- Runtime settings only. Bootstrap -- the database path, the listen port, the
-- secrets file -- cannot live here, because the server cannot read config from a
-- database it has not opened. Instance ORIGINS also stay out: connect-src is
-- generated from them at build time, so an origin typed at runtime is refused by
-- the browser with no status and no body.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value))
) STRICT;
