/**
 * Runtime model discovery.
 *
 * heylook's registry is override-only: any model under a scanned folder is
 * served with derived defaults, so the roster changes when the owner downloads
 * something -- no config edit, no restart. There is no equivalent of
 * `DEFAULT_MODEL`. An id hard-coded here would be a 400 on any machine but the
 * one it was written on, so ids are resolved from the live server and the UI
 * offers what it finds.
 *
 * Capabilities are per-model, not per-provider. With Gemini vision can be
 * assumed; here one served model does vision and the next is text-only, so the
 * feature is gated on the row rather than on the backend.
 */

import { HEYLOOK_INSTANCES } from '../registry';
import { trace } from '../../debug';

export interface HeylookModel {
  id: string;
  /** `mlx`, `mlx_embedding` or `gguf`. Kept for display; nothing branches on it. */
  provider?: string;
  /**
   * What the checkpoint author declared. Deliberately NOT what gating reads:
   * MLX strips audio towers at load, so a model can declare a modality it will
   * never serve.
   */
  modalities?: string[];
  /** What the server will actually serve. This is what gating reads. */
  capabilities?: string[];
}

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

/**
 * The roster, as the server reports it right now.
 *
 * Every failure mode gets its own sentence, because they call for different
 * actions and "could not reach the server" covers all of them badly: the
 * server being down is a thing to start, a non-heylook reply on that port is a
 * thing to look at, and an empty roster is a thing to download a model for.
 */
export async function listModels(
  origin: string = HEYLOOK_INSTANCES[0].origin,
  signal?: AbortSignal,
): Promise<HeylookModel[]> {
  // Discovery runs outside `InferenceClient.call`, so the decorator in
  // `src/debug/instrument.ts` never sees it. Without these two lines the
  // commonest heylook question -- why is the model list empty -- leaves no
  // trace at all.
  const started = Date.now();
  trace('provider', 'provider.discovery.request', `heylook GET ${origin}/v1/models`, { origin });
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/models`, signal ? { signal } : {});
  } catch (cause) {
    // Both spellings pass through. `AbortSignal.timeout()` rejects with a
    // DOMException named `TimeoutError`, NOT `AbortError` -- so rethrowing only
    // the latter buried every timeout in the generic three-way message below,
    // and the caller's TimeoutError branch was unreachable.
    if (cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
      throw cause;
    }
    // Three different problems arrive here identically, as a TypeError with no
    // status and no response, so the message names all three rather than
    // guessing. Blaming the server is the wrong default: it is the only one of
    // the three that `curl` can confirm, which makes it the one most likely to
    // have been ruled out already.
    throw new DiscoveryError(
      `Could not reach heylook at ${origin}, and the failure carries no status -- which means ` +
        'one of three things. The server is not running there; or the page policy refused it, ' +
        'because connect-src is generated from the instance list at build time and a changed ' +
        'origin needs a restart; or the server answered without CORS headers for this page, ' +
        'which a curl check cannot see because curl does not enforce CORS. The browser network ' +
        'tab tells the three apart: no request at all is the policy, a failed OPTIONS preflight ' +
        'is CORS, and a connection error is the server.',
      cause,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(`heylook answered ${response.status} for /v1/models at ${origin}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DiscoveryError(`Reply from ${origin}/v1/models was not JSON.`, cause);
  }

  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) {
    throw new DiscoveryError(
      `Reply from ${origin}/v1/models is not heylook's shape -- no "data" array. Something ` +
        'else may be listening on that port.',
    );
  }

  const models = rows
    .filter((row): row is Record<string, unknown> => row != null && typeof row === 'object')
    .map((row) => ({
      id: String(row.id ?? ''),
      ...(typeof row.provider === 'string' ? { provider: row.provider } : {}),
      ...(Array.isArray(row.modalities) ? { modalities: row.modalities.map(String) } : {}),
      ...(Array.isArray(row.capabilities) ? { capabilities: row.capabilities.map(String) } : {}),
    }))
    .filter((row) => row.id !== '');

  trace(
    'provider',
    'provider.discovery.response',
    `heylook is serving ${models.length} model(s)`,
    { origin, models },
    { durationMs: Date.now() - started, level: models.length === 0 ? 'warn' : 'info' },
  );
  return models;
}

/** Gate on `capabilities`, never on `modalities`. See the type. */
export function canServe(model: HeylookModel | null, capability: string): boolean {
  return model?.capabilities?.includes(capability) ?? false;
}

/**
 * A reasonable default from a roster.
 *
 * Prefers a model that can see, because the app's images are the feature most
 * likely to be silently lost, then anything that can chat, then the first row.
 * Embedding models cannot answer a prompt, so they are never offered.
 */
export function pickDefaultModel(models: HeylookModel[]): HeylookModel | null {
  const usable = models.filter((m) => m.provider !== 'mlx_embedding');
  return (
    usable.find((m) => canServe(m, 'vision')) ?? usable.find((m) => canServe(m, 'chat')) ?? usable[0] ?? null
  );
}

/**
 * What a pre-flight load did, or why it could not.
 *
 * Never an exception, and that is the whole design: this call exists to make a
 * wait visible, so a failure of it must not become a failure of the thing it
 * was making visible. Every outcome is reportable and none is fatal -- the
 * generate that follows resolves the same provider anyway.
 */
export type LoadOutcome =
  | { kind: 'loaded'; ms: number }
  /**
   * The server is generating and cannot make room. Names what is busy.
   *
   * Carries no wait: this call does not retry, so parsing `Retry-After` here
   * would be a second copy of `retryAfterMs` in `client.ts` -- which cannot be
   * imported anyway without a cycle, since that module reads this one. The one
   * that exists has already had a bug (`Date.parse("-1")` succeeds as a year),
   * and a duplicate would not have inherited the fix.
   */
  | { kind: 'busy'; detail: string }
  /** Unknown or disabled id -- the roster moved under us. */
  | { kind: 'rejected'; detail: string }
  /** Unreachable, refused, or a shape we do not recognise. */
  | { kind: 'unreachable'; detail: string };

/**
 * Ask heylook to make a model resident, before anything needs it to be.
 *
 * The problem it solves is invisible rather than slow. A cold load runs BEFORE
 * the response begins, so while multiple gigabytes are read there is nothing on
 * the connection at all -- no headers, no first chunk, no keepalive. Streaming
 * would not help, because the stream has not started. So a non-streaming client
 * cannot tell a loading model from a hung server, and this app is non-streaming.
 * Calling it here relocates that wait into a request that can be labelled.
 *
 * It adds no work: without `warm` this is the same provider resolution the
 * generate call performs on its way in. Measured against the live server --
 * a cold 15GB bf16 model took 3.81s, and the same id already resident answered
 * in 1.4ms. `?warm=true` is deliberately NOT sent: it additionally runs a
 * one-token generation, which takes the generation gate and can therefore queue
 * behind somebody else's long run, turning a pre-flight into a wait.
 *
 * The 503 branch is measured rather than assumed. With one model resident at a
 * time, asking for a second one while the first is generating is refused at the
 * eviction layer before any queue is reached: `cannot make room -- [<id>] is
 * generating`, with `Retry-After: 1`. That is worth reporting verbatim, because
 * unlike most backpressure it names something the person can act on -- their own
 * other generation, which this app has a stop button for.
 */
export async function loadModel(
  origin: string,
  modelId: string,
  options: {
    signal?: AbortSignal;
    /**
     * The transport, injectable for the reason `HeylookClientConfig` carries
     * one: every branch below is a decision about somebody else's status code,
     * and a function that can only be driven by a running server has four
     * branches nothing can reach. The app never passes one.
     */
    fetchImpl?: typeof fetch;
  } = {},
): Promise<LoadOutcome> {
  const { signal, fetchImpl = fetch } = options;
  const started = Date.now();
  const url = `${origin}/v1/models/${encodeURIComponent(modelId)}/load`;
  trace('provider', 'provider.load.request', `heylook POST ${url}`, { origin, model: modelId });

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', ...(signal ? { signal } : {}) });
  } catch (cause) {
    if (cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
      throw cause;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    trace('provider', 'provider.load.error', `heylook load unreachable: ${detail}`, { model: modelId, cause }, { level: 'warn' });
    return { kind: 'unreachable', detail };
  }

  const ms = Date.now() - started;
  // Read once. The body is small on every branch, and a `detail` on the 400 is
  // the only place the server says which ids it does have.
  const body = await response.text();

  if (response.ok) {
    trace('provider', 'provider.load.response', `heylook loaded ${modelId} in ${ms}ms`, { model: modelId, ms, body }, { durationMs: ms });
    return { kind: 'loaded', ms };
  }

  // Busy is decided by what the server SAID, not only by the status it said it
  // with, because the two routes disagree about the code for one condition.
  // Measured, both against the live server within a minute of each other while
  // one model was generating: `/v1/messages` answers 503 with
  // `code: model_overloaded` and `Retry-After: 1`, while this route answers
  // **500** carrying `MODEL_BUSY: cannot make room -- [<id>] is generating`.
  //
  // Reading the status alone put that in the `rejected` branch, whose advice is
  // to refresh the roster -- confidently wrong, since the roster is fine and the
  // condition clears itself. And it cannot be fixed by treating 500 as busy: on
  // this route 500 is also the genuine "that model is broken" answer. The token
  // is the only thing that separates them.
  const busy = response.status === 503 || /MODEL_BUSY/.test(body);
  if (busy) {
    const detail = messageFrom(body) ?? 'the server is busy';
    trace('provider', 'provider.load.busy', `heylook is busy: ${detail}`, { model: modelId, detail, retryAfter: response.headers.get('Retry-After') }, { level: 'warn' });
    return { kind: 'busy', detail };
  }

  const detail = messageFrom(body) ?? `HTTP ${response.status}`;
  trace('provider', 'provider.load.error', `heylook refused ${modelId}: ${detail}`, { model: modelId, status: response.status, detail }, { level: 'warn' });
  return { kind: 'rejected', detail };
}

/**
 * heylook words its errors in two shapes and this reads both.
 *
 * FastAPI's own rejections carry `detail`; the server's own carry
 * `error.message`. A reader that knows only one renders the other as `[object
 * Object]`, which is how a 400 that names every available id becomes useless.
 */
function messageFrom(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as { detail?: unknown; error?: { message?: unknown } };
    if (typeof record.detail === 'string') return record.detail;
    if (typeof record.error?.message === 'string') return record.error.message;
    return null;
  } catch {
    return body.trim() === '' ? null : body.slice(0, 300);
  }
}
