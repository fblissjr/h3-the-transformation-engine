/**
 * `listModels`, driven by an injected transport.
 *
 * Discovery is the most-used heylook path and had no coverage at all, for a
 * structural reason rather than an oversight: it called the global `fetch`, and
 * nothing in this suite stubs one. So every branch below was reachable only by
 * standing up a server in the state it describes -- and a server that is
 * running produces exactly the one branch that needs no explaining.
 *
 * What breaks if this file is deleted: the app's answer to the commonest
 * heylook question. Five throw sites are five different pieces of advice, and
 * a discovery that fails for one reason and reports another sends someone to
 * check the wrong thing. Nothing had ever checked that the right one is
 * chosen; the message named three causes on the strength of having been
 * written carefully.
 *
 * The assertions are on which cause is named, not on the wording. The three-way
 * message is long prose and will be reworded; anchoring on a sentence of it
 * would make this a change detector for the copy. Where a phrase is asserted it
 * is a token the message exists to carry -- a status code, `data`, the word
 * that distinguishes one cause from another -- and never a clause.
 */

import { describe, expect, it } from 'vitest';
import { DiscoveryError, listModels } from '../src/provider/heylook/models';

const ORIGIN = 'http://heylook.test';

/** A transport that answers once, recording what it was asked for. */
function answers(status: number, body: string) {
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

/** A transport that fails the way an unreachable origin does. */
function throws(cause: unknown) {
  return (async () => {
    throw cause;
  }) as unknown as typeof fetch;
}

const ROSTER = JSON.stringify({
  object: 'list',
  data: [
    { id: 'a-vision-model', provider: 'mlx', modalities: ['text', 'vision'], capabilities: ['chat', 'vision'] },
    { id: 'a-text-model', provider: 'mlx', capabilities: ['chat'] },
  ],
});

describe('discovery asks the right endpoint and reads the roster', () => {
  it('gets /v1/models on the origin it was given', async () => {
    const { impl, urls } = answers(200, ROSTER);

    const models = await listModels(ORIGIN, { fetchImpl: impl });

    expect(urls).toEqual([`${ORIGIN}/v1/models`]);
    expect(models.map((m) => m.id)).toEqual(['a-vision-model', 'a-text-model']);
  });

  it('keeps capabilities and modalities apart', async () => {
    // These are two different facts and the type says so at length: MLX strips
    // audio towers at load, so a checkpoint can declare a modality it will
    // never serve. A reader that flattened them would gate vision on a claim
    // rather than on what the server will do.
    const { impl } = answers(200, ROSTER);

    const [vision, text] = await listModels(ORIGIN, { fetchImpl: impl });

    expect(vision.modalities).toEqual(['text', 'vision']);
    expect(vision.capabilities).toEqual(['chat', 'vision']);
    expect(text.modalities).toBeUndefined();
    expect(text.capabilities).toEqual(['chat']);
  });

  it('drops rows with no id rather than offering an unselectable one', async () => {
    const { impl } = answers(
      200,
      JSON.stringify({ data: [{ id: 'real' }, { provider: 'mlx' }, null, 'not-an-object'] }),
    );

    expect((await listModels(ORIGIN, { fetchImpl: impl })).map((m) => m.id)).toEqual(['real']);
  });

  it('reports an empty roster as an empty roster, not as a failure', async () => {
    // A server serving nothing has answered. Making this throw would put it in
    // the same bucket as a server that is down, which is the conflation the
    // roster state machine exists to keep apart one layer up.
    await expect(listModels(ORIGIN, { fetchImpl: answers(200, '{"data":[]}').impl })).resolves.toEqual([]);
  });
});

describe('each failure names its own cause', () => {
  it('names all three indistinguishable causes when there is no status', async () => {
    // The branch this file was written for. A CSP refusal, a CORS refusal and a
    // server that is down all arrive as a bare TypeError with no status and no
    // body, so the message must not pick one -- and the assertion is that all
    // three are named, not how they are worded.
    const error = await listModels(ORIGIN, { fetchImpl: throws(new TypeError('Failed to fetch')) }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DiscoveryError);
    const message = (error as DiscoveryError).message;
    expect(message).toContain('not running');
    expect(message).toContain('connect-src');
    expect(message).toContain('CORS');
    expect(message).toContain(ORIGIN);
    expect((error as DiscoveryError).cause).toBeInstanceOf(TypeError);
  });

  it('reports a bad status as a status rather than as unreachable', async () => {
    // A server that answered 500 is a different problem from one that did not
    // answer, and the advice for it is different. Falling into the three-way
    // message here would send someone to check a CSP that is fine.
    const error = await listModels(ORIGIN, { fetchImpl: answers(500, 'boom').impl }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DiscoveryError);
    expect((error as DiscoveryError).message).toContain('500');
    expect((error as DiscoveryError).message).not.toContain('CORS');
  });

  it('reports a non-JSON reply distinctly from a JSON one of the wrong shape', async () => {
    // Two branches, one sentence apart, and they mean different things: the
    // first is probably not heylook at all, the second answered JSON without a
    // roster in it. Asserting both here is what stops one being deleted into
    // the other.
    const notJson = await listModels(ORIGIN, { fetchImpl: answers(200, '<html>hello</html>').impl }).catch(
      (e: unknown) => e,
    );
    expect((notJson as DiscoveryError).message).toContain('not JSON');

    const wrongShape = await listModels(ORIGIN, {
      fetchImpl: answers(200, '{"models":[]}').impl,
    }).catch((e: unknown) => e);
    expect((wrongShape as DiscoveryError).message).toContain('data');
    expect((wrongShape as DiscoveryError).message).not.toContain('not JSON');
  });
});

describe('an abort is not a discovery failure', () => {
  // The caller distinguishes these to choose its message -- a timeout means the
  // address is reachable and the port is probably wrong, which is the opposite
  // advice from the three-way message. Wrapping either in a DiscoveryError made
  // the caller's TimeoutError branch unreachable once already, when only
  // AbortError was passed through.
  it('rethrows a timeout unwrapped', async () => {
    const timeout = new DOMException('signal timed out', 'TimeoutError');

    const error = await listModels(ORIGIN, { fetchImpl: throws(timeout) }).catch((e: unknown) => e);

    expect(error).toBe(timeout);
    expect(error).not.toBeInstanceOf(DiscoveryError);
  });

  it('rethrows a deliberate abort unwrapped', async () => {
    const abort = new DOMException('aborted', 'AbortError');

    const error = await listModels(ORIGIN, { fetchImpl: throws(abort) }).catch((e: unknown) => e);

    expect(error).toBe(abort);
    expect(error).not.toBeInstanceOf(DiscoveryError);
  });
});
