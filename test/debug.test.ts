/**
 * The debug console, and specifically whether it is WIRED.
 *
 * The buffer and the redactor have unit tests below and those prove very
 * little: they read the value under test directly, so they are green whether or
 * not a single line of the app ever calls them. This repo has produced four
 * bugs of exactly that shape -- `doc.creativeMode` sat past the model call with
 * 400 tests green -- so the weight of this file is on the reachability cases:
 *
 *  - `compile` through an instrumented client records the whole stage sequence,
 *    and records nothing through a bare one. The second half is what makes the
 *    first mean something: without it the events could be coming from anywhere.
 *  - The body `HeylookClient` EMITS is byte-identical to the body it POSTS.
 *    That is the one assertion that can catch a request log describing a
 *    request that was never sent, which is the failure mode a request log has.
 *  - Gemini reaches its emit through the real `call()`, by replacing the SDK
 *    handle. Its transport is not injectable, so this reaches into a private
 *    field; the alternative is asserting `buildRequest` and calling that a
 *    proxy for the emit, which would go green with the emit deleted.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLog,
  instrument,
  MAX_BYTES,
  MAX_EVENT_BYTES,
  MAX_EVENTS,
  MAX_SUMMARY,
  redact,
  resetBus,
  retainedBytes,
  setPaused,
  snapshot,
  subscribe,
  trace,
  type DebugEvent,
} from '../src/debug';
import { tailKey } from '../src/ui/DebugConsole/DebugConsole';
import { compile, edit } from '../src/pipeline';
import { assemble } from '../src/core/assemble';
import { normalize } from '../src/core/normalize';
import type { PlannerOutput } from '../src/core/ir/schema';
import type { CompileInput, H3Document } from '../src/core/ir/types';
import type { CallOptions, CallResult, InferenceClient } from '../src/provider/types';
import { HeylookClient, type HeylookModel } from '../src/provider/heylook';
import { GeminiClient } from '../src/provider/gemini';
import { buildClient } from '../src/provider/build';

beforeEach(() => {
  resetBus();
});

const names = (): string[] => snapshot().map((e) => e.event);
const only = (event: string): DebugEvent[] => snapshot().filter((e) => e.event === event);

// ---------------------------------------------------------------------------
// The buffer
// ---------------------------------------------------------------------------

describe('the buffer is bounded, so a long session cannot grow without limit', () => {
  /**
   * A payload large through STRUCTURE, not through one string.
   *
   * The first version of these two cases used a single enormous string and both
   * went green for the wrong reason: `redact` truncates any one string at
   * MAX_STRING, so five of them come to 120 KB and nothing is ever evicted --
   * and the single-oversized-event case held only because it was the sole event
   * in the buffer. A real large event is large the way `pipeline.parse` is,
   * which carries a whole rejected planner document.
   */
  const bulky = (parts: number) => ({ parts: Array.from({ length: parts }, () => 'x '.repeat(10_000)) });

  it('evicts oldest-first past the byte budget', () => {
    // Sized from the constants, not hard-coded, and it has to sit UNDER the
    // per-event cap or each event is replaced by a note and nothing is ever
    // evicted -- which is how the first version of this went green while
    // asserting nothing. Each part serializes to a little over 20,000 bytes.
    const parts = Math.floor(MAX_EVENT_BYTES / 25_000);
    const count = Math.ceil(MAX_BYTES / (parts * 20_000)) + 2;
    for (let i = 0; i < count; i += 1) trace('state', `state.big${i}`, 'big', bulky(parts));
    expect(retainedBytes()).toBeLessThanOrEqual(MAX_BYTES);
    expect(snapshot().length).toBeLessThan(count);
    expect(names()).not.toContain('state.big0');
    expect(names()).toContain(`state.big${count - 1}`);
  });

  it('caps one enormous payload instead of letting it evict the log', () => {
    // The alternative, and the first thing this did: keep the oversized event
    // until anything else arrived, then drop it -- so the event you were
    // looking at vanished on the next click. Capping the event keeps the row,
    // keeps its neighbours, and says what it dropped.
    trace('state', 'state.small', 'small', { a: 1 });
    trace('state', 'state.huge', 'huge', bulky(300));
    trace('state', 'state.after', 'after');
    expect(names()).toEqual(['state.small', 'state.huge', 'state.after']);
    expect(retainedBytes()).toBeLessThanOrEqual(MAX_BYTES);
    const huge = only('state.huge')[0].detail as Record<string, unknown>;
    expect(huge.oversized).toBe(true);
    expect(huge.keys).toEqual(['parts']);
    expect(only('state.huge')[0].bytes).toBeLessThanOrEqual(MAX_EVENT_BYTES);
  });

  it('evicts past the event ceiling', () => {
    // The byte budget had a control and the count ceiling did not, so nothing
    // could have caught MAX_EVENTS being raised, lowered or dropped. Tiny
    // payloads, so the byte budget cannot be what is doing the work here.
    for (let i = 0; i < MAX_EVENTS + 50; i += 1) trace('state', `state.e${i}`, 'e');
    expect(snapshot()).toHaveLength(MAX_EVENTS);
    expect(names()).not.toContain('state.e0');
    expect(names()).not.toContain('state.e49');
    expect(names()).toContain(`state.e${MAX_EVENTS + 49}`);
  });

  it('bounds the summary, which does not pass through redact', () => {
    // The summary is composed by the caller and concatenated straight in, so
    // without its own cap the per-event cap bounded the detail and nothing
    // else -- and two call sites interpolate unbounded text into one (the edit
    // instruction, and a setting value). One event could then exceed MAX_BYTES
    // and drain the whole buffer in evict(), which is what the cap exists to
    // make unreachable.
    trace('state', 'state.long', 'z'.repeat(200_000));
    const event = only('state.long')[0];
    expect(event.summary.length).toBeLessThan(MAX_SUMMARY + 64);
    expect(event.summary).toContain('more characters');
    expect(event.bytes).toBeLessThanOrEqual(MAX_EVENT_BYTES);
    trace('state', 'state.after', 'after');
    expect(names()).toContain('state.long');
  });

  it('records nothing while paused, and resumes', () => {
    setPaused(true);
    trace('state', 'state.a', 'a');
    setPaused(false);
    trace('state', 'state.b', 'b');
    expect(names()).toEqual(['state.b']);
  });

  it('hands subscribers a new array identity, which is what the panel reads', () => {
    // `useSyncExternalStore` compares by identity. A bus that pushed in place
    // would render the panel once and then never again -- green in a unit test
    // that reads `snapshot()` directly, broken in the app.
    const seen: number[] = [];
    const stop = subscribe(() => seen.push(snapshot().length));
    const before = snapshot();
    trace('state', 'state.a', 'a');
    expect(snapshot()).not.toBe(before);
    expect(seen).toEqual([1]);
    stop();
    trace('state', 'state.b', 'b');
    expect(seen).toEqual([1]);
  });

  it('clears', () => {
    trace('state', 'state.a', 'a', { some: 'payload' });
    clearLog();
    expect(snapshot()).toEqual([]);
    expect(retainedBytes()).toBe(0);
  });
});

describe('the panel follows the tail once the buffer stops growing', () => {
  it('changes its key when the length does not', () => {
    // The whole bug in one assertion. At either bound every new event evicts an
    // old one, so `shown.length` is constant from then on and a length-keyed
    // effect never fires again -- the panel stops following exactly when the
    // log is busiest. Driven through the real buffer rather than a hand-built
    // array, so it is the eviction behaviour under test and not arithmetic.
    for (let i = 0; i < MAX_EVENTS; i += 1) trace('state', `state.f${i}`, 'f');
    const before = snapshot();
    expect(before).toHaveLength(MAX_EVENTS);
    const keyBefore = tailKey(before);

    trace('state', 'state.next', 'next');
    const after = snapshot();
    expect(after).toHaveLength(MAX_EVENTS);
    expect(after.length).toBe(before.length);
    expect(tailKey(after)).not.toBe(keyBefore);
  });

  it('is zero for an empty list rather than throwing', () => {
    expect(tailKey([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe('redaction happens on the way in, not at render time', () => {
  it('elides an attachment under either wire spelling', () => {
    const base64 = 'A'.repeat(4000);
    const gemini = redact({ type: 'image', data: base64, mime_type: 'image/png' }) as Record<string, string>;
    const anthropic = redact({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: base64 },
    }) as { source: Record<string, string> };
    expect(gemini.data).toMatch(/elided: 4000 characters/);
    expect(gemini.mime_type).toBe('image/png');
    expect(anthropic.source.data).toMatch(/elided: 4000 characters/);
  });

  it('elides a base64 blob arriving under a field name it does not know', () => {
    // The safety net under the field-name rule. It cannot fire on prose,
    // because base64 has no spaces and a system prompt does.
    const out = redact({ payload: 'QUJD'.repeat(500) }) as Record<string, string>;
    expect(out.payload).toMatch(/elided/);
  });

  it('leaves a long prompt readable, which is the point of reading one', () => {
    const prompt = 'The baker opens the shutters. '.repeat(40);
    expect(redact({ prompt })).toEqual({ prompt });
  });

  it('blanks secret-shaped field names', () => {
    const out = redact({ apiKey: 'AIza-secret', authorization: 'Bearer x', passphrase: 'hunter2' });
    expect(out).toEqual({ apiKey: '[redacted]', authorization: '[redacted]', passphrase: '[redacted]' });
  });

  it('does NOT blank a bare `key`, which here names a setting', () => {
    // Deliberate: `setSetting('provider', ...)` logs `key: "provider"`, and
    // redacting it would report that something changed without saying what.
    // No secret in this app travels under that name.
    expect(redact({ key: 'heylook-model', value: 'x' })).toEqual({ key: 'heylook-model', value: 'x' });
  });

  it('does not call a shared reference a cycle', () => {
    // The set tracks the current PATH, not everything visited. Tracking
    // "visited" reported the second of two siblings pointing at one object as
    // `[circular]` -- a flatly false label on a payload that has no cycle.
    const shared = { a: 1 };
    expect(redact({ x: shared, y: shared })).toEqual({ x: { a: 1 }, y: { a: 1 } });
    expect(redact([shared, shared])).toEqual([{ a: 1 }, { a: 1 }]);
  });

  it('survives a cycle rather than hanging the app it is watching', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'a', self: '[circular]' });
  });
});

// ---------------------------------------------------------------------------
// Reachability: the pipeline through an instrumented client
// ---------------------------------------------------------------------------

const plan: PlannerOutput = {
  style: 'Live-action, cinematic',
  speakers: [],
  subjects: [],
  shots: [
    {
      cutAtMs: null,
      cutStyle: null,
      camera: null,
      beats: [
        {
          prose: 'a wide shot of a bakery before sunrise.',
          speaker: null,
          dialogue: null,
          visibleText: [],
          citesSlots: [],
          citesSubjects: [],
        },
      ],
    },
  ],
  soundscape: 'Shutters scrape open over a quiet street.',
  music: 'A soft acoustic-guitar pattern at a moderate tempo.',
  summary: null,
  taskTypes: null,
  audioRetention: null,
  pictureRetention: null,
};

const input: CompileInput = {
  idea: 'A baker opens up before dawn.',
  mode: 'T2VA',
  durationFrames: 192,
  slots: [],
};

class StubClient implements InferenceClient {
  readonly providerId = 'gemini' as const;
  readonly canEnforceSchema = true;
  constructor(private readonly reply: unknown) {}
  async call<T>(_options: CallOptions): Promise<CallResult<T>> {
    return {
      text: JSON.stringify(this.reply),
      parsed: this.reply as T,
      status: 'completed',
      usage: { input_tokens: 11 },
      durationMs: 1,
    };
  }
}

const docFor = (): H3Document => assemble(plan, input, normalize(input), { id: 'doc-1' });

describe('a compile is traced from the idea to the rendered prompt', () => {
  it('records every stage, in order', async () => {
    await compile(instrument(new StubClient(plan)), input, { id: 'doc-1' });
    expect(names()).toEqual([
      'pipeline.compile.start',
      'pipeline.normalize',
      'provider.request',
      'provider.response',
      'pipeline.parse',
      'pipeline.assemble',
      'pipeline.validate',
      'pipeline.serialize',
      'pipeline.compile.done',
    ]);
  });

  it('records the provider pair ONLY because the client was instrumented', async () => {
    // The half that makes the case above mean something. Without it, those two
    // events could be coming from the pipeline, and removing the decorator in
    // `useEngine` would leave this file green.
    await compile(new StubClient(plan), input, { id: 'doc-1' });
    expect(names()).not.toContain('provider.request');
    expect(names()).not.toContain('provider.response');
    expect(names()).toContain('pipeline.compile.start');
  });

  it('carries the system prompt and the reply, which is what "what was sent" means', async () => {
    await compile(instrument(new StubClient(plan)), input, { id: 'doc-1' });
    const request = only('provider.request')[0].detail as Record<string, unknown>;
    expect(request.task).toBe('planner');
    expect(request.provider).toBe('gemini');
    expect(String(request.systemInstruction)).toContain('Shot');
    const response = only('provider.response')[0].detail as Record<string, unknown>;
    expect(response.usage).toEqual({ input_tokens: 11 });
    expect(response.parsed).toContain('shots');
  });

  it('reports a failing call as an error and rethrows it', async () => {
    const failing: InferenceClient = {
      providerId: 'heylook',
      canEnforceSchema: false,
      call: async () => {
        throw new Error('the server fell over');
      },
    };
    await expect(compile(instrument(failing), input, { id: 'doc-1' })).rejects.toThrow('fell over');
    const error = only('provider.error')[0];
    expect(error.level).toBe('error');
    expect((error.detail as Record<string, unknown>).message).toBe('the server fell over');
  });

  it('reports a stop as a warning, not a failure', async () => {
    const stopped: InferenceClient = {
      providerId: 'heylook',
      canEnforceSchema: false,
      call: async () => {
        throw new DOMException('Aborted', 'AbortError');
      },
    };
    await expect(compile(instrument(stopped), input, { id: 'doc-1' })).rejects.toThrow();
    expect(names()).toContain('provider.aborted');
    expect(names()).not.toContain('provider.error');
    expect(only('provider.aborted')[0].level).toBe('warn');
  });

  it('records a schema failure with the issues, which is the commonest local failure', async () => {
    await expect(
      compile(instrument(new StubClient({ style: 'only this' })), input, { id: 'doc-1' }),
    ).rejects.toThrow(/did not match the schema/);
    const parse = only('pipeline.parse')[0];
    expect(parse.level).toBe('error');
    expect(Array.isArray((parse.detail as Record<string, unknown>).issues)).toBe(true);
  });
});

describe('an edit is traced through the patch, not only the call', () => {
  it('records what was applied, rejected and declined', async () => {
    const reply = {
      operations: [{ path: 'style', value: 'Anime, cel-shaded', rationale: 'asked for' }],
      declined: null,
    };
    await edit(instrument(new StubClient(reply)), docFor(), ['style'], 'make it anime');
    expect(names()).toContain('pipeline.patch');
    const patch = only('pipeline.patch')[0].detail as Record<string, unknown[]>;
    expect(patch.applied).toHaveLength(1);
    expect(patch.rejected).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Reachability: what each client says it sent, against what it sent
// ---------------------------------------------------------------------------

const TEXT_MODEL: HeylookModel = {
  id: 'mlx-community/Qwen3-8B',
  provider: 'mlx',
  modalities: ['text'],
  capabilities: ['chat'],
};

const call: CallOptions = {
  systemInstruction: 'You expand a creative request.',
  prompt: 'A baker opens the shutters.',
  task: 'planner',
  maxOutputTokens: 64,
};

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const ok = { id: 'msg_1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };

describe('the heylook wire event is the request, not a re-derivation of it', () => {
  it('emits exactly the body that was POSTed', async () => {
    // The assertion that catches a request log describing a request nobody
    // sent. A `describeRequest(options)` rebuilt from CallOptions would pass
    // every other check in this file and fail this one, because heylook resizes
    // its images between the options and the body.
    let posted: unknown;
    const impl = (async (_url: string, init: RequestInit) => {
      posted = JSON.parse(String(init.body));
      return reply(ok);
    }) as unknown as typeof fetch;

    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await client.call(call);

    const wire = only('provider.wire.request')[0].detail as Record<string, unknown>;
    expect(wire.body).toEqual(posted);
    expect(wire.url).toBe('http://x/v1/messages');
  });

  it('emits the body AFTER the resize, which a re-derivation would get wrong', async () => {
    /**
     * The discriminating case, and the reason the one above is not enough.
     *
     * Rebuilding the body from `CallOptions` at emit time passes every other
     * assertion in this file -- verified by making that exact change, which
     * left all 676 tests green -- because without images the raw and resized
     * attachments are identical. heylook resizes between the options and the
     * body, so an image is the only thing that tells the two apart.
     *
     * Resizing needs `createImageBitmap` and `OffscreenCanvas`, which a Node
     * run does not have, so they are stubbed to a fixed oversized bitmap. That
     * makes `canResize()` true and drives the real resize path in
     * `src/provider/heylook/images.ts`; nothing about the resize itself is
     * asserted here beyond the fact that it changed the payload.
     */
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = { bitmap: globals.createImageBitmap, canvas: globals.OffscreenCanvas };
    globals.createImageBitmap = async () => ({ width: 4096, height: 4096, close() {} });
    globals.OffscreenCanvas = class {
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob() {
        return new Blob([new Uint8Array(12)], { type: 'image/jpeg' });
      }
    };

    try {
      let posted: Record<string, unknown> = {};
      const impl = (async (_url: string, init: RequestInit) => {
        posted = JSON.parse(String(init.body));
        return reply(ok);
      }) as unknown as typeof fetch;

      const original = 'A'.repeat(4000);
      const client = new HeylookClient({
        origin: 'http://x',
        model: { ...TEXT_MODEL, capabilities: ['chat', 'vision'] },
        fetchImpl: impl,
      });
      await client.call({ ...call, images: [{ base64: original, mimeType: 'image/png' }] });

      // Redacted on both sides: the buffer holds the elided form, and `redact`
      // is deterministic and separately covered above. What survives elision is
      // the CHARACTER COUNT, which is exactly the field that differs between
      // the body as sent and a body rebuilt from the raw attachment.
      const wire = only('provider.wire.request')[0].detail as Record<string, unknown>;
      expect(wire.body).toEqual(redact(posted));

      const sentImage = (posted.messages as { content: { source?: { data: string } }[] }[])[0]
        .content[0].source!.data;
      expect(sentImage).not.toBe(original);
      expect(JSON.stringify(wire.body)).toContain(`elided: ${sentImage.length} characters`);
      expect(JSON.stringify(wire.body)).not.toContain('elided: 4000 characters');

      // And the resize itself is reported, so the discrepancy between what the
      // pipeline handed over and what went on the wire is explained rather than
      // left looking like a bug in the log.
      const resize = only('provider.resize')[0].detail as Record<string, { base64Chars: number }[]>;
      expect(resize.before[0].base64Chars).toBe(4000);
      expect(resize.after[0].base64Chars).toBe(sentImage.length);
    } finally {
      globals.createImageBitmap = saved.bitmap;
      globals.OffscreenCanvas = saved.canvas;
    }
  });

  it('reports each 503 as a queue wait, with the attempt and the header', async () => {
    // Below the seam and invisible to the decorator, which sees one long call
    // and then either a result or a BackpressureError. "It queued four times
    // over eleven seconds" is the thing worth knowing and only the client knows it.
    let n = 0;
    const impl = (async () => {
      n += 1;
      return n <= 2 ? reply({}, 503, { 'Retry-After': '0' }) : reply(ok);
    }) as unknown as typeof fetch;

    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await client.call(call);

    const waits = only('provider.backpressure');
    expect(waits).toHaveLength(2);
    expect(waits.every((w) => w.level === 'warn')).toBe(true);
    expect((waits[0].detail as Record<string, unknown>).attempt).toBe(1);
    expect((waits[1].detail as Record<string, unknown>).attempt).toBe(2);
    expect((waits[0].detail as Record<string, unknown>).retryAfterHeader).toBe('0');
  });

  it('reports a cancel, which is a fetch nothing else in the app can see', async () => {
    const impl = (async () => reply({ cancelled: 1 })) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await client.cancel('h3-abc');
    const cancel = only('provider.cancel')[0];
    expect((cancel.detail as Record<string, unknown>).cancelled).toBe(1);
    expect(cancel.level).toBe('warn');
  });

  it('reports which JSON-extraction branch ran and whether it found anything', async () => {
    const prose = { id: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json here' }] };
    const impl = (async () => reply(prose)) as unknown as typeof fetch;
    const client = new HeylookClient({ origin: 'http://x', model: TEXT_MODEL, fetchImpl: impl });
    await expect(
      client.call({ ...call, schema: { type: 'object', required: ['style'] } }),
    ).rejects.toThrow(/No JSON object/);
    const parse = only('provider.parse')[0];
    expect(parse.level).toBe('error');
    expect((parse.detail as Record<string, unknown>).extracted).toBeNull();
  });
});

describe('the gemini wire event reaches the real call, not just buildRequest', () => {
  /**
   * Gemini's transport is the SDK and is not injectable, so the handle is
   * replaced on the instance. `private` in TypeScript is a compile-time
   * convention with no runtime effect, which is what makes this possible.
   *
   * The alternative was asserting `buildRequest`'s output and calling that a
   * proxy for the emit -- and that proxy would stay green with the emit line
   * deleted, which is the whole failure this file is about.
   */
  function withStubbedSdk(response: Record<string, unknown>): GeminiClient {
    const client = new GeminiClient({ apiKey: 'AIza-not-a-real-key' });
    (client as unknown as { ai: unknown }).ai = {
      interactions: { create: async () => response },
    };
    return client;
  }

  it('emits the body with store:false and the thinking level, from inside call()', async () => {
    const client = withStubbedSdk({ status: 'completed', output_text: 'hello', id: 'int_1' });
    await client.call(call);
    const wire = only('provider.wire.request')[0].detail as { body: Record<string, unknown> };
    expect(wire.body.store).toBe(false);
    expect((wire.body.generation_config as Record<string, unknown>).thinking_level).toBe('medium');
    expect(only('provider.wire.response')[0].detail).toMatchObject({ status: 'completed' });
  });

  it('reports a non-completed status before throwing, so the id is not lost', async () => {
    const client = withStubbedSdk({ status: 'incomplete', output_text: 'half a doc', id: 'int_2' });
    await expect(client.call(call)).rejects.toThrow(/truncated/i);
    const response = only('provider.wire.response')[0];
    expect(response.level).toBe('warn');
    expect((response.detail as Record<string, unknown>).interactionId).toBe('int_2');
  });

  it('never writes the API key into the log', async () => {
    // The panel has a copy button, so anything reaching the buffer is something
    // someone can paste into a bug report. The key goes to the SDK constructor
    // and is not in the body; this is the check that it stays that way.
    const client = withStubbedSdk({ status: 'completed', output_text: 'hello', id: 'int_1' });
    await client.call(call);
    expect(JSON.stringify(snapshot())).not.toContain('AIza-not-a-real-key');
  });
});

// ---------------------------------------------------------------------------
// Reachability: the client the APP builds, not one a test built
// ---------------------------------------------------------------------------

describe('the client the app runs on is the instrumented one', () => {
  /**
   * The gap this closes.
   *
   * Everything above builds its own `instrument(...)`, so it proves the
   * decorator works and says nothing about whether the app applies it. That
   * wrap lived inside a `useMemo` in `useEngine`, where no test could reach it
   * -- delete it and the whole suite stays green while the panel's provider
   * channel goes silent, which is the shape of every wiring bug this repo has
   * recorded. `buildClient` exists so the assertion can be made at all.
   *
   * A browser pass reached the state and storage channels but could not reach
   * this one: it needs a live backend, and neither was available -- the local
   * server was down and the stored key is passphrase-locked.
   */
  it('records a provider pair for a call made through buildClient', async () => {
    const impl = (async () => reply(ok)) as unknown as typeof fetch;
    const client = buildClient({
      provider: 'heylook',
      origin: 'http://x',
      model: TEXT_MODEL,
      fetchImpl: impl,
    });
    expect(client).not.toBeNull();
    await client!.call(call);
    expect(names()).toContain('provider.request');
    expect(names()).toContain('provider.response');
    // And the decorator did not eat the client's identity on the way past --
    // `notReady`, the schema toggle and the error messages all read these.
    expect(client!.providerId).toBe('heylook');
    expect(client!.canEnforceSchema).toBe(false);
  });

  it('reports not-ready as null rather than an untraced client', () => {
    expect(buildClient({ provider: 'heylook', origin: 'http://x', model: null })).toBeNull();
    expect(buildClient({ provider: 'gemini', apiKey: null })).toBeNull();
  });

  it('instruments the hosted backend too, and keeps its capability', () => {
    const client = buildClient({ provider: 'gemini', apiKey: 'AIza-not-a-real-key' });
    expect(client!.providerId).toBe('gemini');
    expect(client!.canEnforceSchema).toBe(true);
    // A proxy, and named as one: the decorator returns a plain object, so an
    // unwrapped client would still be a GeminiClient. The functional assertion
    // above is the real check; Gemini has no injectable transport to repeat it
    // through, so this is what is reachable here.
    expect(client).not.toBeInstanceOf(GeminiClient);
  });
});
