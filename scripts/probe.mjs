/**
 * Live probes for the Gemini Interactions API.
 *
 * All four unknowns are settled. Results, probed against gemini-3.7-flash:
 *
 *   A. BOTH `models/gemini-3.7-flash` and the bare `gemini-3.7-flash` work.
 *   B. `thinking_level` is read and is snake_case, confirmed on the wire:
 *      48 thought tokens at `low` versus 153 at `high` for "17 * 23", reported
 *      under `usage.total_thought_tokens` and billed at the output rate.
 *      BUT: `minimal` is REJECTED by this model with a 400 -- allowed values
 *      are high, low, medium. The SDK type lists `minimal` because that union
 *      spans ALL models, not this one. Reading a per-model constraint off a
 *      cross-model type was the mistake; only the wire settles it.
 *   C. `response_format: { type, mime_type, schema }` works as typed.
 *   D. CORS ALLOWS browser-origin calls. A page on http://localhost read a 400
 *      body straight from the endpoint, so no dev proxy and no relay is needed.
 *      Not covered by this script -- it runs in Node. See README.
 *
 * Usage: put GEMINI_API_KEY in .env (Bun loads it), then `bun run probe`.
 */

import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function call(model, generationConfig, extra = {}) {
  return ai.interactions.create({
    model,
    input: [{ type: 'text', text: 'What is 17 * 23? Answer with the number only.' }],
    store: false,
    system_instruction: 'You are terse.',
    generation_config: generationConfig,
    ...extra,
  });
}

function thoughtTokens(interaction) {
  const usage = interaction?.usage ?? {};
  for (const [k, v] of Object.entries(usage)) {
    if (/thought|thinking|reasoning/i.test(k) && typeof v === 'number') return v;
  }
  return null;
}

// --- A: model id form ------------------------------------------------------
let model = null;
for (const candidate of ['models/gemini-3.7-flash', 'gemini-3.7-flash']) {
  try {
    const r = await call(candidate, { thinking_level: 'low', max_output_tokens: 256 });
    console.log(`A. model "${candidate}" -> status ${r.status}, output ${JSON.stringify(r.output_text)}`);
    model = model ?? candidate;
  } catch (error) {
    console.log(`A. model "${candidate}" -> FAILED: ${error?.message ?? error}`);
  }
}
if (!model) {
  console.error('No model id worked. Stopping.');
  process.exit(1);
}
console.log(`A. using "${model}"\n`);

// --- B: is thinking_level actually read? -----------------------------------
const minimal = await call(model, { thinking_level: 'low', max_output_tokens: 512 });
const high = await call(model, { thinking_level: 'high', max_output_tokens: 2048 });
const lo = thoughtTokens(minimal);
const hi = thoughtTokens(high);
console.log(`B. thought tokens: low=${lo} high=${hi}`);
console.log(`B. usage keys: ${Object.keys(minimal.usage ?? {}).join(', ')}`);
console.log(
  lo != null && hi != null && hi > lo
    ? 'B. VERDICT: thinking_level is read (snake_case confirmed on the wire).\n'
    : 'B. VERDICT: inconclusive -- inspect the usage keys above.\n',
);

// --- B2: which thinking levels does this model accept? ---------------------
for (const level of ['minimal', 'low', 'medium', 'high']) {
  try {
    await call(model, { thinking_level: level, max_output_tokens: 256 });
    console.log(`B2. thinking_level "${level}" -> accepted`);
  } catch (error) {
    console.log(`B2. thinking_level "${level}" -> REJECTED: ${String(error?.message ?? error).slice(0, 120)}`);
  }
}
console.log('');

// --- C: structured output ---------------------------------------------------
try {
  const structured = await ai.interactions.create({
    model,
    input: [{ type: 'text', text: 'Give me a shot with a camera motion.' }],
    store: false,
    system_instruction: 'Return JSON only.',
    generation_config: { thinking_level: 'low', max_output_tokens: 512 },
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        properties: { camera: { type: 'string' }, prose: { type: 'string' } },
        required: ['camera', 'prose'],
        additionalProperties: false,
      },
    },
  });
  console.log(`C. status ${structured.status}, parsed:`, JSON.parse(structured.output_text));
  console.log('C. VERDICT: response_format works as typed.\n');
} catch (error) {
  console.log(`C. FAILED: ${error?.message ?? error}\n`);
}

// --- temperature: confirm it is ignored rather than rejected ---------------
try {
  const withTemp = await call(model, {
    thinking_level: 'low',
    max_output_tokens: 256,
    temperature: 1.9,
  });
  console.log(`E. temperature accepted (status ${withTemp.status}) -- and per prior probing, ignored.`);
} catch (error) {
  console.log(`E. temperature rejected: ${error?.message ?? error}`);
}
