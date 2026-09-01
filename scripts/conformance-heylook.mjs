/**
 * Which local models can hold the planner's document?
 *
 * The open question on the heylook provider, as CLAUDE.md records it: a green
 * suite says nothing about whether a local model can return the planner's JSON
 * shape with no constrained decoding. This runs the real pipeline -- the same
 * `HeylookClient`, the same `compile`, the same schema parse, assembly and
 * validation the app uses -- against a fixed idea set, one model at a time, and
 * classifies each call by the stage it reached.
 *
 * Stages are reported as separate columns and never folded into one number,
 * because they are different facts about a model:
 *
 *   provider    the call itself failed: HTTP status, backpressure, unreachable
 *   no-json     the reply carried no JSON object at all
 *   truncated   the reply hit the output ceiling with the JSON unfinished
 *   schema      JSON arrived and PlannerOutputSchema refused it
 *   assemble    the plan parsed and cited something that does not exist
 *   diagnostics the document assembled and the validator found errors
 *   clean       zero diagnostics
 *
 * A model that lands on `diagnostics` has held the shape; the validator is
 * reporting a content error, which is a prompt question. A model on `schema` or
 * `no-json` has not. The two must not be summed, and the CLAUDE.md caveat
 * about scoring assembly failures separately from prose is why `assemble` has
 * its own column: it is a known failure of the unconstrained arm, not a verdict
 * on the model's prose.
 *
 * Every row also carries the rendered prompt text, so the output doubles as
 * the input to an outside grader. Nothing here judges the prose. That needs a
 * render.
 *
 * Usage:
 *   bun scripts/conformance-heylook.mjs --model=<id>[,<id>...] [--set=t2va|ref2va|all]
 *        [--n=N] [--out=path.jsonl] [--probe]
 *
 * `--probe` makes one call on the first idea and stops, to see latency and
 * whether the shape survives at all before spending a run. Reads
 * VITE_HEYLOOK_ORIGIN, defaulting to the local server.
 */

import { appendFileSync } from 'node:fs';

import { compile, PlanError } from '../src/pipeline.ts';
import { AssembleError } from '../src/core/assemble.ts';
import { HeylookClient } from '../src/provider/heylook/client.ts';
import { listModels, loadModel } from '../src/provider/heylook/models.ts';
import { BackpressureError, ProviderError, TruncatedError } from '../src/provider/types.ts';
import { snapshot } from '../src/debug/index.ts';

const ORIGIN = process.env.VITE_HEYLOOK_ORIGIN ?? 'http://127.0.0.1:42193';
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const MODELS = arg('model', '').split(',').filter(Boolean);
const SET = arg('set', 'all');
const N = Number(arg('n', '0')) || 0;
const OUT = arg('out', `internal/conformance-${new Date().toISOString().slice(0, 10)}.jsonl`);
const PROBE = process.argv.includes('--probe');

if (MODELS.length === 0) {
  console.error('usage: bun scripts/conformance-heylook.mjs --model=<id>[,<id>...] [--set=t2va|ref2va|all] [--n=N] [--out=path] [--probe]');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The idea set
// ---------------------------------------------------------------------------

/**
 * One idea per feature the schema can express, so a failure names the feature.
 * 192 frames is 8.00s on the 17k+5 grid, long enough for two shots and a cut.
 */
const T2VA = [
  { key: 'quiet', idea: 'A locksmith cuts a key in a cramped shop while a customer waits.' },
  { key: 'one-speaker', idea: 'A florist hands a wrapped bouquet across the counter and tells the customer it will last a week if the water is changed daily.' },
  { key: 'two-speakers', idea: 'Two removal men carry a sofa up a narrow staircase and argue about which way to tilt it.' },
  { key: 'sung', idea: 'A busker on a station platform sings a short chorus of an original folk song while commuters pass.' },
  { key: 'cross-cut', idea: 'A radio presenter finishes a sentence as the picture cuts from the studio to a listener in a kitchen, her voice continuing over the cut.' },
  { key: 'cutoff', idea: 'A man on a doorstep starts to explain why he is late and the video ends mid-sentence.' },
  { key: 'on-screen-text', idea: 'A hand pins a paper notice reading "CLOSED FOR REPAIRS" to a shop door, then steps back.' },
  { key: 'voiceover', idea: 'A woman walks a coastal path at dusk while her own voice, off screen, recalls the first time she came here.' },
];

/** Ref2VA with written descriptions only, which is what the app can attach today for video and audio. */
const REF2VA = [
  {
    key: 'ref-person',
    idea: 'She reads a letter at a kitchen table, folds it, and looks out of the window.',
    slots: [
      {
        id: 'slot-1', order: 0, kind: 'image', roles: ['identity'],
        description: 'A woman in her sixties with short grey hair, round tortoiseshell glasses, a navy cardigan over a white shirt, photographed head-on in soft daylight.',
      },
    ],
  },
  {
    key: 'ref-video-edit',
    idea: 'Keep the video exactly as it is but replace the coffee cup with a glass of orange juice.',
    slots: [
      {
        id: 'slot-1', order: 0, kind: 'video', roles: ['edit_source'],
        description: 'Ten seconds of a man in a grey hoodie at a cafe table, lifting a white ceramic coffee cup, sipping, and setting it down, single static shot, no speech.',
      },
    ],
  },
  {
    key: 'ref-timbre',
    idea: 'A night-shift security guard on the phone tells his daughter a bedtime story over the radio.',
    slots: [
      {
        id: 'slot-1', order: 0, kind: 'audio', roles: ['voice'],
        description: 'A warm, low male voice with a slight rasp, speaking slowly and gently; the words themselves are not to be reused.',
      },
    ],
  },
];

function jobsFor(set) {
  const jobs = [];
  if (set === 't2va' || set === 'all') {
    for (const j of T2VA) jobs.push({ ...j, mode: 'T2VA', slots: [] });
  }
  if (set === 'ref2va' || set === 'all') {
    for (const j of REF2VA) jobs.push({ ...j, mode: 'Ref2VA' });
  }
  return N > 0 ? jobs.slice(0, N) : jobs;
}

// ---------------------------------------------------------------------------
// Capturing what the pipeline says on the way past
// ---------------------------------------------------------------------------

/** The bus events for one call, so a schema failure can name its issues. */
function capture() {
  const since = snapshot().length;
  const mine = () => snapshot().slice(since);
  return {
    /** Each issue with the value the model actually wrote at that path, since zod's message omits it. */
    parseIssues: () => {
      const detail = mine().find((e) => e.event === 'pipeline.parse' && e.detail?.ok === false)?.detail;
      if (!detail) return null;
      return detail.issues.map((issue) => {
        const value = issue.path.reduce((node, key) => (node == null ? undefined : node[key]), detail.received);
        return `${issue.path.join('.')}: ${issue.message} (got ${JSON.stringify(value)})`;
      });
    },
  };
}

function classify(error) {
  if (error instanceof PlanError) return 'schema';
  if (error instanceof AssembleError) return 'assemble';
  if (error instanceof TruncatedError) return 'truncated';
  if (error instanceof BackpressureError) return 'provider';
  if (error instanceof ProviderError) return /No JSON object/.test(error.message) ? 'no-json' : 'provider';
  return 'provider';
}

const isNA = (s) => typeof s === 'string' && /^n\/?a\.?$/i.test(s.trim());
const words = (s) => s.split(/\s+/).filter(Boolean).length;

async function runOne(client, job, modelId) {
  const input = { idea: job.idea, mode: job.mode, durationFrames: 192, slots: job.slots };
  const cap = capture();
  const started = Date.now();
  const row = { model: modelId, key: job.key, mode: job.mode, idea: job.idea, durationFrames: 192 };
  try {
    const result = await compile(client, input, { id: `conf-${job.key}`, seed: 7 });
    const doc = result.doc;
    const codes = result.validation.diagnostics.map((d) => d.code);
    Object.assign(row, {
      stage: codes.length === 0 ? 'clean' : 'diagnostics',
      diagnostics: codes,
      shots: doc.shots.length,
      beats: doc.shots.reduce((n, s) => n + s.beats.length, 0),
      speakers: doc.speakers.length,
      dialogueLines: doc.shots.reduce((n, s) => n + s.beats.filter((b) => b.dialogue).length, 0),
      musicNA: isNA(doc.music),
      renderedWords: words(result.rendered.text),
      rendered: result.rendered.text,
      usage: result.usage,
    });
  } catch (error) {
    Object.assign(row, {
      stage: classify(error),
      error: String(error?.message ?? error).slice(0, 400),
      issues: cap.parseIssues()?.slice(0, 8) ?? null,
    });
  }
  row.ms = Date.now() - started;
  return row;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const roster = await listModels(ORIGIN);
const jobs = jobsFor(SET);
console.log(`origin ${ORIGIN}; ${jobs.length} idea(s) x ${MODELS.length} model(s); writing ${OUT}`);

const all = [];
for (const modelId of MODELS) {
  const model = roster.find((m) => m.id === modelId);
  if (!model) {
    console.error(`${modelId}: not in the roster. Served ids:\n  ${roster.map((m) => m.id).join('\n  ')}`);
    process.exit(2);
  }
  const loadStarted = Date.now();
  const load = await loadModel(ORIGIN, modelId);
  console.log(`\n${modelId}: load ${load.kind} in ${Date.now() - loadStarted}ms; capabilities ${JSON.stringify(model.capabilities)}`);

  const client = new HeylookClient({ origin: ORIGIN, model });
  for (const job of PROBE ? jobs.slice(0, 1) : jobs) {
    const row = await runOne(client, job, modelId);
    all.push(row);
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    const tail =
      row.stage === 'clean' || row.stage === 'diagnostics'
        ? `${row.shots} shots, ${row.beats} beats, ${row.dialogueLines} lines, ${row.renderedWords} words` +
          (row.diagnostics.length ? `; ${row.diagnostics.join(',')}` : '')
        : (row.issues?.[0] ?? row.error ?? '').slice(0, 120);
    console.log(`  ${String(row.ms).padStart(7)}ms  ${row.stage.padEnd(11)} ${job.key.padEnd(15)} ${tail}`);
  }
  if (PROBE) break;
}

// Summary, one line per model, stages as separate columns.
const STAGES = ['clean', 'diagnostics', 'assemble', 'schema', 'truncated', 'no-json', 'provider'];
console.log('\n' + ['model'.padEnd(40), ...STAGES.map((s) => s.padStart(11)), '   mean ms'].join(''));
for (const modelId of MODELS) {
  const rows = all.filter((r) => r.model === modelId);
  if (rows.length === 0) continue;
  const counts = STAGES.map((s) => String(rows.filter((r) => r.stage === s).length).padStart(11));
  const mean = Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length);
  console.log(modelId.slice(0, 40).padEnd(40) + counts.join('') + String(mean).padStart(10));
}
