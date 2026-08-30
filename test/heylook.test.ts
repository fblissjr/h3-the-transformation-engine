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
  canResize,
  canServe,
  joinTextBlocks,
  normalizeOrigin,
  pickDefaultModel,
  resizeAll,
  resizeAttachment,
  retryAfterMs,
  HeylookClient,
  type HeylookModel,
} from '../src/provider/heylook';
import { extractJsonObject, jsonShapeTrailer, withShapeTrailer } from '../src/provider/shape';
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

  it('finds the document nested inside a wrapper object', () => {
    // The case the skip used to defeat. A model that answers
    // {"result": {...}} offers a wrapper that resembles nothing; the document
    // is inside it, so a scan that skipped past every match never saw it and
    // returned the wrapper. Both old behaviours got this wrong -- longest-match
    // for the same reason.
    const doc = '{"style":"s","shots":[],"speakers":[]}';
    const wrapped = `{"result": ${doc}}`;
    expect(extractJsonObject(wrapped, ['style', 'shots', 'speakers'])).toBe(doc);
  });

  it('prefers a partial top-level document over the schema properties map', () => {
    // The two reply shapes pull opposite ways, and this is the one that made
    // an earlier rule wrong. An echoed schema contains a `properties` object
    // whose keys ARE the field names being looked for, so it resembles the
    // request perfectly -- better than a document that omits optional fields.
    // Score alone therefore returns the schema. A nested object has to be a
    // fallback rather than a competitor to a plausible top-level answer.
    const schema = JSON.stringify(plannerJsonSchema(), null, 2);
    const partial = '{"style":"s","shots":[],"speakers":[]}';
    const keys = ['style', 'shots', 'speakers', 'subjects', 'soundscape', 'music'];
    expect(schema).toContain('"properties"');
    expect(extractJsonObject(`${schema}\n${partial}`, keys)).toBe(partial);
  });

  it('still prefers a top-level match over descending needlessly', () => {
    // The common case must not get slower or change answer: a document at the
    // top level resembles the request, so the scan stops rather than walking
    // its own children looking for a better one.
    const doc = '{"style":"s","shots":[{"beats":[]}]}';
    expect(extractJsonObject(doc, ['style', 'shots'])).toBe(doc);
  });

  it('scores an object that has none of the wanted keys below one that has them', () => {
    const wanted = ['style', 'shots'];
    const decoy = '{"explanation":"the document follows","note":"see below"}';
    const doc = '{"style":"s","shots":[]}';
    expect(extractJsonObject(`${decoy}\n${doc}`, wanted)).toBe(doc);
    // And the decoy wins when it is the only object, rather than returning null.
    expect(extractJsonObject(decoy, wanted)).toBe(decoy);
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

  it('gives up after a bounded number of FAILED starts, not successful ones', () => {
    // Prose all the way down must cost a bounded scan, since an unbalanced `{`
    // scans to the end of the string. Twenty-five unclosed braces exhausts it.
    expect(extractJsonObject(`${'{ '.repeat(25)}\nnope`)).toBeNull();
    // But any number of REAL objects must stay reachable. Counting successes
    // toward the same cap made a document unreachable behind twenty valid
    // objects, which is the bug this pair now pins from both sides.
    const doc = '{"style":"s","shots":[]}';
    const many = Array.from({ length: 50 }, (_, n) => `{"n":${n}}`).join('\n');
    expect(extractJsonObject(`${many}\n${doc}`, ['style', 'shots'])).toBe(doc);
  });

  it('prefers the object that resembles what was asked for, not the biggest one', () => {
    // The failure this replaces: the trailer hands the model the serialized
    // schema, so echoing it back is a plausible reply -- and the schema is far
    // longer than any document written against it, so "longest wins" returned
    // the schema with confidence. Size was never the discriminator; carrying
    // the requested keys is.
    const schema = JSON.stringify(plannerJsonSchema(), null, 2);
    const doc = '{"style":"s","shots":[],"speakers":[]}';
    expect(schema.length).toBeGreaterThan(doc.length * 100);

    const echoed = `Here is the schema I will follow:\n${schema}\n${doc}`;
    expect(extractJsonObject(echoed, ['style', 'shots', 'speakers'])).toBe(doc);
    // Without the keys there is nothing to resemble, so length still decides --
    // the old behaviour, kept for callers that ask for no particular shape.
    expect(extractJsonObject(echoed)).toBe(schema);
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
    expect(retryAfterMs('99999')).toBe(15_000);
    expect(retryAfterMs(new Date(Date.now() + 86_400_000).toUTCString())).toBe(15_000);
  });

  it('reads the live server\'s own header as a poll interval, not a completion estimate', () => {
    // Probed against heylook 1.79.42 while a generation was running: the reply
    // is `Retry-After: 1` with "is generating -- wait for it to finish". One
    // second is how often to ask, not how long it will take, so the retry
    // budget is wall-clock rather than a count of attempts. Three retries on
    // this header gave up after four seconds against a two-minute generation.
    expect(retryAfterMs('1')).toBe(1000);
  });

  it('falls back rather than waiting zero on a header it cannot read', () => {
    // A zero here would turn a queue into a busy loop against a server that is
    // already saturated.
    expect(retryAfterMs(null)).toBeGreaterThan(0);
    expect(retryAfterMs('soon please')).toBeGreaterThan(0);
    expect(retryAfterMs('-1')).toBeGreaterThan(0);
  });
});

describe('the retry loop itself, not just the header arithmetic', () => {
  // Previously unreachable: `post` is private, nothing built a client, and only
  // the pure `retryAfterMs` helper was exercised. The floor, the backoff and
  // the deadline were three lines no test could touch.
  const busyThen = (busyCount: number, retryAfter = '1') => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      if (calls <= busyCount) {
        return new Response(JSON.stringify({ error: { code: 'model_overloaded' } }), {
          status: 503,
          headers: { 'Retry-After': retryAfter },
        });
      }
      return new Response(
        JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    return { impl, calls: () => calls };
  };

  it('retries a 503 and returns the eventual success', async () => {
    const { impl, calls } = busyThen(2);
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    const result = await client.call({ ...base, maxOutputTokens: 8 });
    expect(result.text).toBe('ok');
    expect(calls()).toBe(3);
  });

  it('does not busy-loop on Retry-After: 0', async () => {
    // The floor exists for exactly this: a server answering "retry immediately"
    // must not be polled as fast as the event loop allows.
    const { impl } = busyThen(1, '0');
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    const started = Date.now();
    await client.call({ ...base, maxOutputTokens: 8 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it('refuses a per-call model switch rather than silently ignoring it', async () => {
    // Gemini resolves CallOptions.model; this client is bound to a capability
    // row at construction, so honouring a bare id would gate vision against the
    // wrong model. Refusing is the only option that does not diverge silently
    // between backends -- and it had no test until the transport became
    // injectable in the same change that made this reachable.
    const never = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: never });
    await expect(
      client.call({ ...base, model: 'some-other-model' }),
    ).rejects.toThrow(/cannot switch to some-other-model/);
  });

  it('accepts a per-call model that names the one it is already bound to', async () => {
    const ok = (async () =>
      new Response(
        JSON.stringify({ id: 'm', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: ok });
    await expect(client.call({ ...base, model: TEXT_MODEL.id })).resolves.toMatchObject({ text: 'ok' });
  });

  it('gives up as backpressure rather than retrying forever', async () => {
    // Deleting the deadline check would hang here instead of throwing, which is
    // what makes this the assertion that the deadline exists.
    const alwaysBusy = (async () =>
      new Response('{}', { status: 503, headers: { 'Retry-After': '3600' } })) as unknown as typeof fetch;
    const client = new HeylookClient({
      origin: 'http://x',
      model: TEXT_MODEL,
      fetchImpl: alwaysBusy,
      // A budget the test can wait for. The default is five minutes, matched to
      // a server whose generations run for minutes -- which is exactly why this
      // path had never been executed by anything.
      backpressureBudgetMs: 1200,
    });
    await expect(client.call({ ...base, maxOutputTokens: 8 })).rejects.toThrow(/still busy/);
  });

  it('does not retry a 400, which is not backpressure', async () => {
    const refuse = (async () =>
      new Response(JSON.stringify({ detail: 'no such model' }), { status: 400 })) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: refuse });
    await expect(client.call({ ...base, maxOutputTokens: 8 })).rejects.toThrow(/refused the request/);
  });
});

describe('cancelling takes an explicit call, because hanging up does not work', () => {
  // Measured on a live server: a 73.1s non-streaming run aborted at 5.0s left
  // the next request waiting 57.9s. Nothing is written to the connection until
  // the run finishes, so the server never learns the client left. DELETE is the
  // only thing that actually stops it, and on a box that runs one generation at
  // a time that is the difference between freeing the GPU and freeing the user.

  it('sends the request id it will later cancel by', async () => {
    const seen: string[] = [];
    const impl = (async (_url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>)['X-Request-ID']);
      return new Response(
        JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await client.call({ ...base, maxOutputTokens: 8 });
    // Present and non-empty: the server honours this header as of 1.79.44, and
    // before that generated its own, so a client that omitted it held a handle
    // that did not exist.
    expect(seen[0]).toMatch(/^h3-/);
  });

  it('issues DELETE against that id when the signal aborts', async () => {
    const deletes: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      if (init.method === 'DELETE') {
        deletes.push(url);
        return new Response(JSON.stringify({ cancelled: 1, request_id: 'x' }), { status: 200 });
      }
      // A generation that never returns on its own, so only the abort ends it.
      // The fake has to honour the signal the way real fetch does, or the call
      // hangs and the test measures the fake rather than the client.
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    const call = client.call({ ...base, maxOutputTokens: 8, signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await call.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toMatch(/^http:\/\/x\/v1\/requests\/h3-/);
  });

  it('treats a 404 from the cancel as too late, not as a failure', async () => {
    // Ids are tracked only while in flight, so 404 almost always means the run
    // already finished. Nothing the caller can act on.
    const impl = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(client.cancel('h3-gone')).resolves.toBe(0);
  });

  it('reports the count, because ids are not assumed unique server-side', async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ cancelled: 2, request_id: 'dup' }), { status: 200 })) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(client.cancel('dup')).resolves.toBe(2);
  });

  it('survives a server with no cancel endpoint at all', async () => {
    // Older builds predate it. A cancel that cannot be delivered must not throw
    // into a stop button.
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(client.cancel('h3-x')).resolves.toBe(0);
  });

  it('does not tell someone who pressed stop to raise their token ceiling', async () => {
    // A cancelled run reports stop_reason: max_tokens, because Anthropic's
    // vocabulary has no cancellation value. The wire cannot distinguish cancel
    // from truncation, so the client reads its own flag.
    //
    // NAMED PROXY: this fake deliberately does NOT honour the signal, unlike
    // the one above -- real fetch would reject with AbortError first and the
    // guard would never be reached. So this exercises a narrow race (the
    // response landing before the abort propagates) rather than the path the
    // stop button takes, which ends in AbortError from fetch itself. Keep the
    // guard, but read a failure here as being about the race, not the button.
    const controller = new AbortController();
    const impl = (async (_url: string, init: RequestInit) => {
      if (init.method === 'DELETE') return new Response(JSON.stringify({ cancelled: 1 }), { status: 200 });
      controller.abort();
      return new Response(
        JSON.stringify({ id: 'm', content: [{ type: 'text', text: '{"partial":' }], stop_reason: 'max_tokens' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(
      client.call({ ...base, maxOutputTokens: 8, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still reports a genuine truncation as truncation', async () => {
    // The other side of the same branch: nothing cancelled, so max_tokens means
    // what it says and the partial text has to survive for the caller.
    const impl = (async () =>
      new Response(
        JSON.stringify({ id: 'm', content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(client.call({ ...base, maxOutputTokens: 8 })).rejects.toMatchObject({
      name: 'TruncatedError',
      partialText: 'partial',
    });
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

describe('the planner is told when there is nothing to reference', () => {
  // Measured, not supposed. Against a local 27B with no constrained decoding,
  // a T2VA job with no slots repeatedly came back with a subject sourced from
  // reference slot 0, which `assemble` refuses. The block said nothing about
  // references at all in that case, and an unconstrained model fills a silence.
  //
  // Anchored on the field names the instruction has to name -- those are
  // structural and appear in the schema -- rather than on the sentence around
  // them, so rewording it for clarity does not fail this.
  const bare: CompileInput = {
    idea: 'A baker opens up before dawn.',
    mode: 'T2VA',
    durationFrames: 192,
    slots: [],
  };

  const withSlot: CompileInput = {
    ...bare,
    mode: 'I2VA',
    slots: [
      {
        id: 's1',
        order: 0,
        kind: 'image',
        roles: ['first_frame'],
        filename: 'ref.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        description: '',
      },
    ],
  };

  it('says the absence out loud when no slot is attached', () => {
    const prompt = buildPlannerSystemPrompt(normalize(bare), bare);
    expect(prompt).toContain('citesSlots');
    expect(prompt).toContain('subjects as an empty array');
  });

  it('names subjects on the ref contract too, where the registry actually exists', () => {
    // Ref2VA with no slots is reachable -- the mode select offers every mode
    // regardless of what is attached -- and it is the one contract with a
    // subject registry, so it is where an unfilled silence does the most harm.
    // The first version of this instruction covered only the base contract.
    const ref: CompileInput = { ...bare, mode: 'Ref2VA' };
    const prompt = buildPlannerSystemPrompt(normalize(ref), ref);
    expect(prompt).toContain('subjects as an empty array');
    expect(prompt).toContain('citesSlots');
  });

  it('asks for an empty array, never for a subject with no sources', () => {
    // The first version of this instruction said "leave subjects[].sources
    // empty", which the schema forbids -- a subject requires at least one
    // source -- and a run of `subjects.0.sources: too_small` followed. Asking
    // for an invalid document is worse than saying nothing, so the wrong
    // phrasing is pinned as forbidden rather than left to a reviewer to catch.
    const prompt = buildPlannerSystemPrompt(normalize(bare), bare);
    expect(prompt).not.toContain('subjects[].sources');
  });

  it('says the opposite when a slot is attached, rather than both', () => {
    // The failure this guards against is the two branches drifting into saying
    // there is nothing to cite in a job that has something to cite.
    const prompt = buildPlannerSystemPrompt(normalize(withSlot), withSlot);
    expect(prompt).toContain('Reference assets, already labelled');
    expect(prompt).not.toContain('There are no reference assets');
  });
});

describe('image downscaling degrades rather than fails', () => {
  it('reports that this runtime cannot resize, instead of pretending it did', () => {
    // A PROXY, named because it has to be. `createImageBitmap` and
    // `OffscreenCanvas` do not exist under vitest's node environment, so this
    // asserts the fallback branch is the one taken here -- it does NOT check
    // that resizing works, which is only reachable in a browser. A green here
    // says the no-canvas path is safe, nothing more.
    expect(canResize()).toBe(false);
  });

  it('returns the attachment untouched when it cannot resize', async () => {
    // The property that matters: a runtime without canvas still sends a working
    // image. Failing here would mean a Node script or a test could not send one
    // at all, and an oversized image is strictly better than no image.
    const attachment = { base64: 'AAAA', mimeType: 'image/png' };
    expect(await resizeAttachment(attachment)).toBe(attachment);
    expect(await resizeAll([attachment])).toEqual([attachment]);
  });

  it('keeps the list aligned, so a caller cannot mismatch images to slots', async () => {
    const many = [
      { base64: 'AAAA', mimeType: 'image/png' },
      { base64: 'BBBB', mimeType: 'image/jpeg' },
      { base64: 'CCCC', mimeType: 'image/webp' },
    ];
    const out = await resizeAll(many);
    expect(out).toHaveLength(3);
    expect(out.map((a) => a.base64)).toEqual(['AAAA', 'BBBB', 'CCCC']);
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
