/**
 * The music-lean measurement, run against heylook instead of Gemini.
 *
 * Does the planner obey the non_diegetic_music lean, and does the wording it
 * replaced behave differently on the same ideas? Run against a local model,
 * because that is the backend with credentials on this machine -- the shipped
 * Gemini default has no key here and its arm of this comparison is unrun.
 *
 * Two things are measured at once, and they should not be confused when
 * reporting:
 *
 *   1. whether a local model can hold the planner's JSON shape at all, which is
 *      the open question on this provider and which nothing in the suite covers
 *   2. whether the lean changes what lands in `music`
 *
 * heylook cannot enforce a schema, so (1) is a real risk and a parse failure is
 * a result rather than a bug. The schema is appended to the system prompt the
 * way the shipped client does it.
 *
 * Running only the shipped prompt would give a rate, not an effect, so both
 * wordings go through the same ideas. The conditions matter as much as the
 * counts: a set of obviously score-free ideas cannot tell the two apart, and
 * concluding "no effect" from one would be a scope error. It was, on the first
 * run -- the difference lives entirely in the atmospheric middle.
 *
 * Usage: bun scripts/music-lean-heylook.mjs [model] [--n=N] [--only=CONDITION]
 * With no --n it makes a single probe call and stops.
 */

import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from '../src/provider/prompts/planner.ts';
import { normalize } from '../src/core/normalize/index.ts';
import { plannerJsonSchema } from '../src/core/ir/schema.ts';
import { jsonShapeTrailer } from '../src/provider/shape.ts';

const ORIGIN = process.env.VITE_HEYLOOK_ORIGIN ?? 'http://127.0.0.1:42193';
const MODEL = process.argv[2] ?? 'gemma-4-26B-A4B-it-qat-4bit-g32-mlx';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7) || null;
const N = Number((process.argv.find((a) => a.startsWith('--n=')) ?? '--n=0').slice(4)) || 0;

const NEW_MUSIC =
  '`music` covers score only the audience can hear. Write "N/A" unless the request asks for music';
const OLD_MUSIC =
  '`music` covers score only the audience can hear, in 1-3 sentences. Name instrumentation, tempo, ' +
  'rhythm and dynamics. Never mood words like "emotional" or "epic". Music a character can hear is ' +
  'a diegetic event and belongs in the beats. Use "N/A" when there is no score.';

const QUIET = [
  'A locksmith cuts a key in a cramped shop while a customer waits.',
  'Two coworkers disagree about a spreadsheet in an open-plan office.',
  'A woman repots a plant on a balcony in the morning.',
  'A man misses the last bus and walks home in the rain.',
  'A chef plates a dish during a dinner rush.',
  'A child stacks blocks until the tower falls over.',
];
const SCORED = [
  'A film-trailer montage of a heist crew assembling, cut to a driving orchestral score.',
  'A sportswear ad: quick cuts of runners at dawn with an upbeat electronic track underneath.',
  'A wistful title sequence, piano underscoring a couple packing up a house.',
  'A nature-documentary opening: sweeping shots of a glacier under a slow string score.',
];


/**
 * The cases where a lean would actually bite: atmospheric, emotional scenes
 * with no music mentioned, which is where a model reaches for a score unasked.
 * The QUIET set above is too easy to distinguish the two wordings, and reporting
 * "no effect" from it alone would be a scope error.
 */
const AMBIGUOUS = [
  'A woman sits alone on a rooftop at night, city lights below.',
  'A man packs the last box in an empty apartment and looks around.',
  'Slow motion: a runner collapses at the finish line as the crowd blurs.',
  'A couple say goodbye at an airport gate.',
  'Rain runs down a window as a girl watches, chin on her hands.',
  'An old man visits a grave and sets down flowers.',
];

const CONDITIONS = [['quiet', QUIET], ['ambiguous', AMBIGUOUS], ['scored', SCORED]];

const schema = plannerJsonSchema();
const trailer = jsonShapeTrailer(schema);

function systemPrompt(idea, variant) {
  const input = { idea, mode: 'T2VA', durationFrames: 96, slots: [] };
  const shipped = buildPlannerSystemPrompt(normalize(input), input);
  let core = shipped;
  if (variant === 'old') {
    const start = shipped.indexOf(NEW_MUSIC);
    if (start < 0) throw new Error('the shipped music paragraph is not where this script expects it');
    const marker = shipped.indexOf('belongs in the beats, not here.', start);
    if (marker < 0) throw new Error('cannot find the end of the shipped music paragraph');
    const end = shipped.indexOf('\n', marker);
    core = shipped.slice(0, start) + OLD_MUSIC + shipped.slice(end < 0 ? shipped.length : end);
  }
  return core + trailer;
}

async function plan(idea, variant) {
  const input = { idea, mode: 'T2VA', durationFrames: 96, slots: [] };
  const started = Date.now();
  const response = await fetch(`${ORIGIN}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt(idea, variant) },
        { role: 'user', content: buildPlannerUserPrompt(input) },
      ],
      max_tokens: 8192,
      stream: false,
    }),
  });
  const ms = Date.now() - started;
  if (!response.ok) return { ms, error: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}` };
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content ?? '';
  // The unconstrained path: the model may fence the JSON or prepend prose.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fenced ? fenced[1] : text).trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last < 0) return { ms, error: 'no JSON object in the reply', sample: text.slice(0, 160) };
  try {
    const doc = JSON.parse(raw.slice(first, last + 1));
    return { ms, music: typeof doc.music === 'string' ? doc.music.trim() : '(no music field)' };
  } catch (error) {
    return { ms, error: `unparseable: ${String(error?.message ?? error).slice(0, 120)}`, sample: raw.slice(0, 160) };
  }
}

const isNA = (s) => /^n\/?a\.?$/i.test(s.trim());

// Guard: the comparison is worthless if the two prompts are the same string.
const a = systemPrompt(QUIET[0], 'new');
const b = systemPrompt(QUIET[0], 'old');
if (a === b) {
  console.error('ABORT: old and new prompts are identical.');
  process.exit(1);
}
console.log(`model: ${MODEL}`);
console.log(`prompts differ: ${a.length} vs ${b.length} chars; lean present new=${a.includes('Write "N/A" unless')} old=${b.includes('Write "N/A" unless')}`);

if (N === 0) {
  // Probe: one call, to see latency and whether the shape survives at all.
  console.log('\nprobe: one call on the shipped prompt...');
  const r = await plan(QUIET[0], 'new');
  console.log(`  ${r.ms} ms  ${r.error ? 'ERROR ' + r.error : 'music = ' + JSON.stringify(r.music)}`);
  if (r.sample) console.log(`  sample: ${JSON.stringify(r.sample)}`);
  process.exit(0);
}

const jobs = [];
for (const variant of ['new', 'old']) {
  for (const [condition, ideas] of CONDITIONS) {
    if (ONLY && condition !== ONLY) continue;
    for (const idea of ideas.slice(0, N)) jobs.push({ variant, condition, idea });
  }
}
const results = [];
for (const job of jobs) {
  const r = await plan(job.idea, job.variant);
  results.push({ ...job, ...r });
  process.stderr.write(`  ${results.length}/${jobs.length}  ${r.ms}ms  ${r.error ? 'ERR' : ''}\n`);
}

for (const variant of ['new', 'old']) {
  for (const [condition] of CONDITIONS) {
    if (ONLY && condition !== ONLY) continue;
    const rows = results.filter((r) => r.variant === variant && r.condition === condition);
    const ok = rows.filter((r) => r.music != null);
    const na = ok.filter((r) => isNA(r.music));
    console.log(`\n${variant.toUpperCase()} / ${condition}: ${na.length}/${ok.length} N/A` +
      (ok.length < rows.length ? `  (${rows.length - ok.length} failed to parse)` : ''));
    for (const r of rows) {
      const mark = r.music == null ? 'ERR  ' : isNA(r.music) ? 'N/A  ' : 'score';
      console.log(`  ${mark} ${r.idea.slice(0, 46).padEnd(46)} ${(r.music ?? r.error).slice(0, 64)}`);
    }
  }
}
