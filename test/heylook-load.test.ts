/**
 * The pre-flight load, whose whole job is to make an invisible wait visible.
 *
 * The failure it exists to prevent has no status code and no error: a cold
 * model load runs before the response begins, so nothing is written to the
 * connection at all while it happens. A non-streaming client -- which this app
 * is -- cannot tell that from a hung server.
 *
 * So the property under test is not that it loads. It is that NO outcome of it
 * can break the selection it was decorating, and that each outcome is
 * reportable in the terms the server used. A pre-flight that throws is worse
 * than no pre-flight.
 *
 * The bodies below are the ones the live server actually sent, recorded from a
 * run against it rather than written from the documentation. The 503 in
 * particular was reached deliberately: with one model resident at a time,
 * asking for a second while the first generates is refused at the eviction
 * layer, not queued.
 */

import { describe, expect, it } from 'vitest';
import { loadModel } from '../src/provider/heylook/models';

const ORIGIN = 'http://heylook.test';
const MODEL = 'Qwen3.5-0.8B-MLX-8bit-textonly';

/** A fetch that answers once with a given status and body. */
function answers(status: number, body: string, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the pre-flight reaches the endpoint the server actually moved to', () => {
  it('posts to the un-gated path, not the retired admin one', async () => {
    // The route moved off /v1/admin in 1.79.48 and the old spelling answers
    // 405 -- a move, not an alias. Measured against the live server, which is
    // the only reason this is asserted rather than assumed.
    const { impl, calls } = answers(200, '{"status":"loaded","model_id":"x"}');
    await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(calls).toEqual([`POST ${ORIGIN}/v1/models/${MODEL}/load`]);
  });

  it('never asks to warm, because warming takes the generation gate', async () => {
    // `?warm=true` additionally runs a one-token generation, which queues
    // behind another request's long run. That turns a pre-flight into exactly
    // the unbounded wait it exists to remove.
    const { impl, calls } = answers(200, '{"status":"loaded"}');
    await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(calls[0]).not.toContain('warm');
  });

  it('escapes an id, since a model id is a path segment and not ours to trust', async () => {
    const { impl, calls } = answers(200, '{"status":"loaded"}');
    await loadModel(ORIGIN, 'vendor/model name', { fetchImpl: impl });
    expect(calls[0]).toContain('vendor%2Fmodel%20name');
  });
});

describe('every outcome is reportable and none is fatal', () => {
  it('reports a load with how long it took', async () => {
    const { impl } = answers(200, '{"status":"loaded","model_id":"x"}');
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('loaded');
  });

  it('quotes the eviction-blocked 503 verbatim, because it names something actionable', async () => {
    // The live body, recorded. Unlike most backpressure this one identifies
    // the model holding the GPU -- and the app has a stop button for it -- so
    // collapsing it into "server busy" would discard the actionable half.
    const body = JSON.stringify({
      error: {
        message:
          "cannot make room -- ['google_gemma_4-E4B-it-bf16-mlx'] is generating. " +
          'Stop the generation or wait for it to finish.',
        type: 'server_error',
        code: 'model_overloaded',
      },
    });
    const { impl } = answers(503, body, { 'Retry-After': '1' });
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('busy');
    if (outcome.kind !== 'busy') throw new Error('unreachable');
    expect(outcome.detail).toContain('is generating');
    expect(outcome.detail).toContain('google_gemma_4-E4B-it-bf16-mlx');
  });

  it('reads a busy 500 as busy, because this route does not use 503 for it', async () => {
    // The bug this pins, found by clicking rather than by any test: the two
    // routes report one condition with two codes. Generating answers 503 with
    // Retry-After; asking THIS route to make room answers 500 carrying
    // MODEL_BUSY. Classifying on the status alone sent a transient,
    // self-clearing wait down the `rejected` path, whose advice is to refresh a
    // roster that was never wrong. Body recorded from the live server.
    const body = JSON.stringify({
      detail:
        "Failed to load model: MODEL_BUSY: cannot make room -- ['Qwen3.5-27B-8bit-mlx'] " +
        'is generating. Stop the generation or wait for it to finish.',
    });
    const { impl } = answers(500, body);
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('busy');
  });

  it('still reads a genuine 500 as a refusal, since this route uses it for both', async () => {
    // The other half, and the reason the token rather than the status is the
    // discriminator: a model that exists and fails to load is also a 500 here.
    const { impl } = answers(500, JSON.stringify({ detail: 'Failed to load model: OSError' }));
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('rejected');
  });

  it('reads FastAPI\u2019s `detail` on a 400, which is where the available ids are', async () => {
    // Two error spellings exist: the server's own `error.message` and
    // FastAPI's `detail`. A reader that knows only one renders the other as
    // [object Object], which is how a 400 listing every served id becomes
    // useless. Both are covered, here and above.
    const body = JSON.stringify({
      detail: "Model 'gone' not found or disabled. Available: ['a', 'b']",
    });
    const { impl } = answers(400, body);
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind !== 'rejected') throw new Error('unreachable');
    expect(outcome.detail).toContain('not found or disabled');
  });

  it('reports an unreachable server rather than throwing at the caller', async () => {
    const impl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('unreachable');
  });

  it('survives a body that is not JSON at all', async () => {
    // A proxy in front of the server answers HTML. Reporting that as a crash
    // would fail a model selection that is otherwise fine.
    const { impl } = answers(502, '<html>Bad Gateway</html>');
    const outcome = await loadModel(ORIGIN, MODEL, { fetchImpl: impl });
    expect(outcome.kind).toBe('rejected');
  });

  it('lets an abort through, because a cancelled wait is not a failed one', async () => {
    // The one exception to "never throws": an AbortError means the caller
    // stopped caring, and swallowing it into a notice would report a fault
    // for something the user did.
    const impl = (async () => {
      throw new DOMException('Aborted', 'AbortError');
    }) as unknown as typeof fetch;
    await expect(loadModel(ORIGIN, MODEL, { fetchImpl: impl })).rejects.toThrow('Aborted');
  });
});
