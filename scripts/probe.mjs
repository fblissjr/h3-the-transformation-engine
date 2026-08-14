/**
 * Live probes for the Gemini Interactions API.
 *
 * Two of the four unknowns this project started with were settled from the
 * installed SDK types and need no call:
 *
 *   - `generation_config.thinking_level` is snake_case, values
 *     minimal | low | medium | high.   (@google/genai 2.17.1)
 *   - `response_format` is
 *     { type: 'text', mime_type: 'application/json', schema }.
 *
 * The two that remain genuinely need the wire:
 *
 *   A. Which model id form works: `models/gemini-3.7-flash` or bare.
 *   B. Whether thinking_level actually moves thought-token usage, which is the
 *      only way to prove the field is being read rather than ignored the way
 *      `temperature` is.
 *
 *   C. Structured output round-trips.
 *   D. Browser CORS -- not covered here. Run the dev server and call from the
 *      page; this script runs in Node and proves nothing about the browser.
 *
 * Usage: GEMINI_API_KEY=... bun run probe
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
    const r = await call(candidate, { thinking_level: 'minimal', max_output_tokens: 256 });
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
const minimal = await call(model, { thinking_level: 'minimal', max_output_tokens: 512 });
const high = await call(model, { thinking_level: 'high', max_output_tokens: 2048 });
const lo = thoughtTokens(minimal);
const hi = thoughtTokens(high);
console.log(`B. thought tokens: minimal=${lo} high=${hi}`);
console.log(`B. usage keys: ${Object.keys(minimal.usage ?? {}).join(', ')}`);
console.log(
  lo != null && hi != null && hi > lo
    ? 'B. VERDICT: thinking_level is read (snake_case confirmed on the wire).\n'
    : 'B. VERDICT: inconclusive -- inspect the usage keys above.\n',
);

// --- C: structured output ---------------------------------------------------
try {
  const structured = await ai.interactions.create({
    model,
    input: [{ type: 'text', text: 'Give me a shot with a camera motion.' }],
    store: false,
    system_instruction: 'Return JSON only.',
    generation_config: { thinking_level: 'minimal', max_output_tokens: 512 },
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
    thinking_level: 'minimal',
    max_output_tokens: 256,
    temperature: 1.9,
  });
  console.log(`E. temperature accepted (status ${withTemp.status}) -- and per prior probing, ignored.`);
} catch (error) {
  console.log(`E. temperature rejected: ${error?.message ?? error}`);
}
