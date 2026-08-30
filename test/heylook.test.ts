/**
 * The heylook client's wire properties, and the one thing it does that no
 * other check in this repo can see.
 *
 * That one thing first, because it is the reason this file exists rather than
 * a few cases bolted onto `test/provider.test.ts`:
 *
 * Gemini's `response_format` constrains decoding, so the planner's document
 * parses by construction. heylook has no equivalent, so the shape is asked for
 * in prose -- and the asking happens in the CLIENT, after
 * `buildPlannerSystemPrompt` has returned. `test/contract.test.ts` indexes into
 * that builder's output directly, so it describes a string that is no longer
 * the one sent to the model, and it stays green whatever the client appends.
 * That is precisely the "green because the check never arrives" shape CLAUDE.md
 * warns about, so the assembled system prompt is asserted here.
 *
 * Everything else is a property of the wire that would otherwise be a comment:
 * that the system prompt is top-level rather than a message, that the image
 * block uses the nested spelling, that a thinking block's text never reaches
 * the parser, and that a 503 is read as a queue rather than a failure.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  canServe,
  extractJsonObject,
  joinTextBlocks,
  jsonShapeTrailer,
  normalizeOrigin,
  pickDefaultModel,
  retryAfterMs,
  withShapeTrailer,
  type HeylookModel,
} from '../src/provider/heylook';
import type { CallOptions } from '../src/provider/types';
import { plannerJsonSchema } from '../src/core/ir/schema';
import { buildPlannerSystemPrompt } from '../src/provider/prompts/planner';
import { normalize } from '../src/core/normalize';
import type { CompileInput } from '../src/core/ir/types';

const VISION_MODEL: HeylookModel = {
  id: 'mlx-community/Qwen2.5-VL-7B',
  provider: 'mlx',
  modalities: ['text', 'vision'],
  capabilities: ['chat', 'vision'],
};

const TEXT_MODEL: HeylookModel = {
  id: 'mlx-community/Qwen3-8B',
  provider: 'mlx',
  modalities: ['text'],
  capabilities: ['chat', 'thinking'],
};

const base: CallOptions = {
  systemInstruction: 'You expand a creative request.',
  prompt: 'A baker opens the shutters.',
  task: 'planner',
};

const build = (extra: Partial<CallOptions> = {}, model: HeylookModel | null = TEXT_MODEL) =>
  buildRequest({ ...base, ...extra }, extra.images ?? [], model);

// ---------------------------------------------------------------------------
// The shape trailer: what stands in for constrained decoding
// ---------------------------------------------------------------------------

describe('the schema reaches the model as prose, because it cannot reach it as a constraint', () => {
  const input: CompileInput = {
    idea: 'A baker opens up before dawn.',
    mode: 'T2VA',
    durationFrames: 192,
    slots: [],
  };
  const builderOutput = buildPlannerSystemPrompt(normalize(input), input);
  const schema = plannerJsonSchema();

  it('sends the builder output unchanged, with the trailer after it', () => {
    // The builder's output is what contract.json describes. It has to survive
    // whole: a client that rewrote any of it would put the spec and the sent
    // prompt out of step with nothing to notice.
    const sent = String(build({ systemInstruction: builderOutput, schema }).system);
    expect(sent.startsWith(builderOutput)).toBe(true);
    expect(sent.length).toBeGreaterThan(builderOutput.length);
  });

  it('names the schema by serializing it rather than describing it', () => {
    // Anchored on the schema's own content, not on the trailer's wording. A
    // paraphrase of a nested shape is a second copy that drifts; this asserts
    // there is only one copy. `beats` is a planner field, so its presence in
    // the sent prompt means the real schema travelled.
    const sent = String(build({ systemInstruction: builderOutput, schema }).system);
    expect(sent).toContain(JSON.stringify(schema, null, 2));
    expect(sent).toContain('"beats"');
  });

  it('adds nothing at all when no shape was asked for', () => {
    expect(build({ systemInstruction: builderOutput }).system).toBe(builderOutput);
    expect(withShapeTrailer('prompt', undefined)).toBe('prompt');
  });

  it('forbids the two things a local model does instead of emitting bare JSON', () => {
    // A wording proxy: there is no structural anchor for "do not wrap it in a
    // fence", so a rewording of these instructions fails this test without
    // breaking anything. Read a failure here as a fact about the test first.
    const trailer = jsonShapeTrailer({ type: 'object' });
    expect(trailer.toLowerCase()).toContain('fence');
    expect(trailer.toLowerCase()).toContain('single json object');
  });
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

describe('the Messages wire', () => {
  it('puts the system prompt at the top level, not in messages', () => {
    // Chat templates disagree about a system message inside the conversation,
    // and a raised jinja exception on the gguf path is a 500 rather than a
    // readable refusal.
    const request = build();
    expect(request.system).toBe(base.systemInstruction);
    const messages = request.messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user']);
  });

  it('puts media before the question', () => {
    const request = build({ images: [{ base64: 'AAAA', mimeType: 'image/png' }] }, VISION_MODEL);
    const content = (request.messages as { content: { type: string }[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(['image', 'text']);
  });

  it('uses the nested source spelling, which every surface accepts', () => {
    // The flat `source_type` form still works on the generation endpoint but
    // not on heylook's conversation store, so only one of the two is portable.
    const request = build({ images: [{ base64: 'AAAA', mimeType: 'image/png' }] }, VISION_MODEL);
    const content = (request.messages as { content: Record<string, unknown>[] }[])[0].content;
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(content[0]).not.toHaveProperty('source_type');
  });

  it('never streams', () => {
    // Off the stream a refusal is a plain 400. On it, the guard fires after the
    // headers have flushed, so the same refusal arrives in-band and a naive
    // reader renders a diagnostic as model output.
    expect(build().stream).toBe(false);
  });

  it('omits max_tokens rather than inventing one', () => {
    // heylook makes max_tokens optional where Anthropic requires it. Absent
    // means the server's sampler cascade decides; a client-side default would
    // silently override the model's own configured floor on every call that had
    // no opinion.
    expect(build()).not.toHaveProperty('max_tokens');
    expect(build({ maxOutputTokens: 4096 }).max_tokens).toBe(4096);
  });

  it('never sends stop_sequences, which this server ignores rather than honours', () => {
    // Anthropic accepts the field. heylook has no such field, so a client that
    // relied on it would generate straight past the sequence with no error.
    expect(build()).not.toHaveProperty('stop_sequences');
  });

  it('sends no temperature, for a different reason than the Gemini client does', () => {
    // Gemini accepts and ignores it. heylook honours it -- so the absence here
    // is not the same fact, and the ban does not travel between them. It is
    // absent because this app has no temperature control, and a value invented
    // by the client would override the model's configured default.
    expect(build()).not.toHaveProperty('temperature');
  });

  it('asks for thinking off only where the model has the switch', () => {
    // reasoning_effort and thinking are per-model. Sending a field to a model
    // that has no such template variable is how a wrong value reaches a chat
    // template and returns a 500.
    expect(build({}, TEXT_MODEL).thinking).toBe(false);
    expect(build({}, VISION_MODEL)).not.toHaveProperty('thinking');
    expect(build({}, null)).not.toHaveProperty('thinking');
  });

  it('omits the model id entirely when none was resolved', () => {
    // Rather than sending a guess. With no id the server falls back to whatever
    // it has loaded, which is a better answer than a 400 on a wrong name.
    expect(build({}, null)).not.toHaveProperty('model');
    expect(build({}, TEXT_MODEL).model).toBe(TEXT_MODEL.id);
  });
});

// ---------------------------------------------------------------------------
// Reading the reply
// ---------------------------------------------------------------------------

describe('a thinking block is not the answer', () => {
  it('joins text blocks and leaves reasoning out', () => {
    // The trap: a thinking block carries its content under BOTH `thinking` and
    // `text`, the second for backwards compatibility. A reader that maps every
    // block's `text` picks up the reasoning while looking like it filtered.
    const content = [
      { type: 'thinking', thinking: 'Let me consider the shot count.', text: 'Let me consider the shot count.' },
      { type: 'text', text: '{"beats":[]}' },
    ];
    expect(joinTextBlocks(content)).toBe('{"beats":[]}');
  });

  it('joins several text blocks in order', () => {
    expect(joinTextBlocks([{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }])).toBe('{"a":1}');
  });

  it('survives a reply with no content at all', () => {
    expect(joinTextBlocks(undefined)).toBe('');
    expect(joinTextBlocks([])).toBe('');
    expect(joinTextBlocks([{ type: 'logprobs', tokens: [] }])).toBe('');
  });
});

describe('finding JSON in a reply that was only asked nicely for it', () => {
  it('takes a clean object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('unwraps a markdown fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('skips a preamble', () => {
    expect(extractJsonObject('Here is the plan:\n\n{"a":1}')).toBe('{"a":1}');
  });

  it('skips a brace in the preamble that closes on its own', () => {
    // The reason candidates are walked rather than the first `{` taken. A model
    // asked to emit a schema-shaped object talks about braces.
    const reply = 'The schema uses {} for an empty object. Here it is:\n{"a":1}';
    expect(extractJsonObject(reply)).toBe('{"a":1}');
  });

  it('is not confused by braces inside string values', () => {
    // A beat's prose can contain one, and a glitch mark very well might.
    const json = '{"beat":"the sign reads {ERROR}","n":1}';
    expect(extractJsonObject(`chatter\n${json}`)).toBe(json);
  });

  it('takes the whole object when it is nested', () => {
    const json = '{"a":{"b":{"c":[1,2]}}}';
    expect(extractJsonObject(json)).toBe(json);
  });

  it('reports failure rather than returning something unparseable', () => {
    expect(extractJsonObject('I cannot do that.')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
    // Truncated: opens and never closes.
    expect(extractJsonObject('{"a":1')).toBeNull();
  });

  it('gives up after a bounded number of false starts', () => {
    // A reply that is prose all the way down must cost a bounded scan, not a
    // quadratic one. Twenty-five unclosed braces, then real JSON: the object is
    // past the cap and is deliberately NOT found.
    const noise = '{ '.repeat(25);
    expect(extractJsonObject(`${noise}\n{"a":1}`)).toBeNull();
    // Under the cap, the same shape resolves.
    expect(extractJsonObject(`${'{ '.repeat(3)}\n{"a":1}`)).toBe('{"a":1}');
  });
});

// ---------------------------------------------------------------------------
// Backpressure, discovery, config
// ---------------------------------------------------------------------------

describe('503 is a queue, not a failure', () => {
  it('reads Retry-After in seconds', () => {
    expect(retryAfterMs('5')).toBe(5000);
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads Retry-After as an HTTP date', () => {
    const soon = new Date(Date.now() + 4000).toUTCString();
    const ms = retryAfterMs(soon);
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it('never waits longer than the cap, whatever the header says', () => {
    expect(retryAfterMs('99999')).toBe(30_000);
    expect(retryAfterMs(new Date(Date.now() + 86_400_000).toUTCString())).toBe(30_000);
  });

  it('falls back rather than waiting zero on a header it cannot read', () => {
    // A zero here would turn a queue into a busy loop against a server that is
    // already saturated.
    expect(retryAfterMs(null)).toBeGreaterThan(0);
    expect(retryAfterMs('soon please')).toBeGreaterThan(0);
    expect(retryAfterMs('-1')).toBeGreaterThan(0);
  });
});

describe('capabilities decide what is offered, modalities do not', () => {
  it('reads capabilities and ignores modalities', () => {
    // The divergence is deliberate on the server's side: MLX strips audio
    // towers at load, so a checkpoint can declare a modality it never serves.
    const declaresButCannot: HeylookModel = {
      id: 'x',
      modalities: ['text', 'audio', 'vision'],
      capabilities: ['chat'],
    };
    expect(canServe(declaresButCannot, 'vision')).toBe(false);
    expect(canServe(declaresButCannot, 'audio')).toBe(false);
    expect(canServe(VISION_MODEL, 'vision')).toBe(true);
  });

  it('treats an absent capability list as serving nothing extra', () => {
    expect(canServe({ id: 'x' }, 'vision')).toBe(false);
    expect(canServe(null, 'vision')).toBe(false);
  });

  it('prefers a vision model, and never offers an embedding model', () => {
    const embedding: HeylookModel = { id: 'e5', provider: 'mlx_embedding', capabilities: [] };
    expect(pickDefaultModel([embedding, TEXT_MODEL, VISION_MODEL])?.id).toBe(VISION_MODEL.id);
    expect(pickDefaultModel([embedding, TEXT_MODEL])?.id).toBe(TEXT_MODEL.id);
    expect(pickDefaultModel([embedding])).toBeNull();
    expect(pickDefaultModel([])).toBeNull();
  });
});

describe('the origin is normalized once, for both the client and the policy', () => {
  it('strips trailing slashes so a path never doubles up', () => {
    expect(normalizeOrigin('http://studio.local:8000/')).toBe('http://studio.local:8000');
    expect(normalizeOrigin('http://studio.local:8000///')).toBe('http://studio.local:8000');
  });

  it('falls back rather than producing an empty origin', () => {
    // An empty string here would build `/v1/models` as a same-origin path,
    // which the CSP allows and which answers 404 from the dev server -- a
    // confusing success shape for a missing configuration.
    expect(normalizeOrigin(undefined)).toBe('http://localhost:8000');
    expect(normalizeOrigin('   ')).toBe('http://localhost:8000');
  });
});
