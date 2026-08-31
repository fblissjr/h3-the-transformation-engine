/**
 * The heylook client: a local inference server on this network.
 *
 * `/v1/messages` conforms to Anthropic's Messages API, so the block shapes and
 * the `stop_reason` vocabulary are Anthropic's. What does not transfer from a
 * hosted provider is everything that follows from the server being local and
 * single-user, and that is most of what this file is:
 *
 *  - **No constrained decoding.** Neither wire has an equivalent of Gemini's
 *    `response_format` schema. The shape is asked for in the system prompt and
 *    the reply is parsed defensively -- see `./json.ts`.
 *  - **Model ids are install-local.** There is no default to ship. The id comes
 *    from `/v1/models` at runtime, and the capability row comes with it so that
 *    sending images to a text-only model is caught before the call.
 *  - **Non-streaming, on purpose.** Once a stream's headers have flushed the
 *    status is 200, so a late refusal arrives in-band as an `error` event and a
 *    naive reader renders a diagnostic as model output. Off the stream that
 *    same refusal is a plain 400. The Gemini client does not stream either, and
 *    nothing in this app renders tokens as they arrive, so streaming would buy
 *    complexity and no feature.
 *  - **503 is normal, and retrying it is right.** Measured against heylook
 *    1.79.53 (`GET /v1/capabilities` -> `server_version`), on an mlx model.
 *    The version is named because the commit that first recorded these numbers
 *    did not name one -- the same scope failure this session had just written a
 *    rule about, committed inside the fix for it. Only ONE mlx model is
 *    resident at a time, and asking
 *    for a second one while the first is generating is refused rather than
 *    queued -- `503`, `code: "model_overloaded"`, body "cannot make room --
 *    ['<other model>'] is generating. Stop the generation or wait for it to
 *    finish." The headers carry `retry-after: 1`, `x-ratelimit-limit: 1`,
 *    `x-ratelimit-remaining: 0`. The refusal arrived 0.58s into a 5.77s
 *    generation, so that `1` is a literal and not an estimate of the work
 *    remaining -- do not tune backoff to it, which is why `retryAfterMs` treats
 *    it as a floor. Reproduced on .53 with the refusal arriving 2.5ms into a
 *    4.29s generation: same header, 4.29s of work left, so `1` is not an
 *    estimate of anything. The server's own message says to wait, so this client's
 *    retry loop is doing the right thing with it.
 *
 *    What is NOT established, and was previously asserted here as "the server
 *    serialises generation for one user": whether the mlx generation gate is
 *    process-global or per-provider. Two different mlx models cannot be
 *    co-resident on this box -- loading one evicts the other, timed at 1.6s to
 *    reload an evicted model against 0.0014s for a resident one -- so the
 *    experiment that would separate those has no reachable setup here. It does
 *    not matter to this client: the app is single-flight regardless.
 *  - **Cancelling needs an explicit call.** Hanging up does NOT stop a
 *    non-streaming generation: measured, a 73.1s run aborted at 5.0s left the
 *    next request waiting 57.9s, because nothing is written to the connection
 *    until the run finishes and the server never learns the client has gone.
 *    `DELETE /v1/requests/{id}` (server 1.79.44+) is the thing that actually
 *    stops it, keyed on the `X-Request-ID` this client already sends. On a
 *    machine that runs one generation at a time, that is the difference between
 *    freeing the GPU and merely freeing the user.
 *  - **`max_tokens` is optional here**, unlike Anthropic's required field.
 *    Absent means the server's sampler cascade decides. The planner and patch
 *    ceilings are real opinions so they are sent; nothing else is invented.
 *  - **`thinking` is a bool**, not Anthropic's config object -- it is the local
 *    template's `enable_thinking` switch, a different mechanism with the same
 *    name. It is sent as false, and only to models whose row advertises the
 *    capability. Depth (`reasoning_effort`) is NOT sent at all: measured across
 *    low/medium/high/xhigh on a 27B gguf, every level produced a worse planner
 *    document than omitting the field, so there is nothing to gate. This
 *    paragraph previously described gating that no line of this file performed.
 *  - **A thinking model returns a `thinking` block beside `text`.** Only `text`
 *    blocks are joined; joining everything puts the model's reasoning into the
 *    planner's JSON and nothing parses.
 *
 * `temperature` is not sent, but for a different reason than on Gemini, where
 * it is accepted and ignored. heylook honours it. It is absent because this app
 * has no temperature control and inventing a value would override the model's
 * own configured default on every call.
 */

import {
  BackpressureError,
  extractUsage,
  ProviderError,
  TruncatedError,
  type CallOptions,
  type CallResult,
  type ImageAttachment,
  type InferenceClient,
  type ProviderId,
} from '../types';
import { HEYLOOK_INSTANCES } from '../registry';
import { extractJsonObject, requiredKeys, withShapeTrailer } from '../shape';
import { canServe, type HeylookModel } from './models';
import { resizeAll } from './images';
import { trace } from '../../debug';

/**
 * Anthropic's vocabulary; only `end_turn` and `max_tokens` occur in practice.
 *
 * A CANCELLED run also reports `max_tokens`, because Anthropic's spec has no
 * cancellation value and that is the closest "stopped early, not by the model's
 * own choice". So `stop_reason` cannot distinguish a cancellation from a budget
 * exhaustion, and this client must not try: it reads its own cancel flag
 * instead. Getting that wrong would report "raise maxOutputTokens" to someone
 * who pressed stop.
 */
const STOP_TRUNCATED = 'max_tokens';

/**
 * How long a queued request keeps queueing, as wall-clock rather than attempts.
 *
 * An attempt count was the wrong unit, and the live server said so: it answers
 * `Retry-After: 1` with the message "is generating -- wait for it to finish",
 * which is an instruction to poll every second, not a claim that it will be
 * free in one. Three retries against that header gave up after four seconds,
 * while the generation it was queued behind ran for two minutes. That is a
 * spurious failure on the one condition the server documents as normal.
 */
const BACKPRESSURE_BUDGET_MS = 5 * 60_000;
/** Used when a 503 arrives without a usable `Retry-After`. */
const DEFAULT_RETRY_MS = 2000;
/** Nothing waits longer than this between polls, however large `Retry-After` is. */
const MAX_RETRY_MS = 15_000;
/** A server that says "retry immediately" still should not be polled in a tight loop. */
const MIN_RETRY_MS = 1000;

export interface HeylookClientConfig {
  /**
   * Where to send requests.
   *
   * Should come from `instanceFor()` in the registry, which is the only source
   * of origins the CSP is generated from. The default here is the first
   * configured instance rather than `HEYLOOK_ORIGIN`, because reading that
   * variable directly is what let the policy and the client name different
   * hosts.
   */
  origin?: string;
  /**
   * The transport, injectable so the retry loop can be driven without a server.
   *
   * It had no test at all: `post` is private, nothing constructed a client, and
   * the only thing exercised was the pure `retryAfterMs` helper. So the
   * MIN_RETRY_MS floor, the backoff and the deadline were three unreached
   * lines, and deleting the deadline check would have turned a busy server into
   * an infinite retry with the whole suite still green.
   */
  fetchImpl?: typeof fetch;
  /**
   * How long to keep queueing behind a busy server, in milliseconds.
   *
   * Comes from the resolved policy (`retryTimeoutMs`), which is why it is a
   * parameter rather than the constant it used to be: five minutes is right for
   * a machine whose generations take minutes and wrong for one that answers in
   * seconds, and that is a fact about the machine. Falls back to the module
   * default so a client constructed with no policy still behaves.
   */
  backpressureBudgetMs?: number;
  /**
   * The model to call, with the capability row it was discovered with.
   *
   * Carried whole rather than as an id so that vision gating reads the same
   * record the roster showed. An id alone would mean either a second lookup or
   * a guess.
   */
  model?: HeylookModel | null;
}

/**
 * Assemble the request body.
 *
 * Pure and separate from `call` for the same reason Gemini's is: the shape can
 * then be asserted with no server, no network and nothing running. It takes
 * already-resized images, because resizing needs the DOM and this does not.
 */
export function buildRequest(
  options: CallOptions,
  images: ImageAttachment[],
  model: HeylookModel | null,
): Record<string, unknown> {
  // Media first, then the question: the prompt then reads as instructions
  // about material already presented. Same ordering as the Gemini client, for
  // the same reason.
  const content: Record<string, unknown>[] = [];
  for (const image of images) {
    // The nested `source` spelling. heylook accepts its older flat form too,
    // but the nested one is what its conversation store accepts and what an
    // Anthropic client sends, so it is the one that works on every surface.
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
    });
  }
  content.push({ type: 'text', text: options.prompt });

  const request: Record<string, unknown> = {
    ...(model?.id ? { model: model.id } : {}),
    // Top-level, not a system role in `messages`. Chat templates disagree about
    // a system message mid-conversation, and a raised jinja exception on the
    // gguf path surfaces as a 500.
    system: withShapeTrailer(options.systemInstruction, options.schema),
    messages: [{ role: 'user', content }],
    // Sent because these are real opinions about output length. Everything else
    // sampling-related is omitted so the model's own configuration decides.
    ...(options.maxOutputTokens != null ? { max_tokens: options.maxOutputTokens } : {}),
    ...(options.seed != null ? { seed: options.seed } : {}),
    stream: false,
  };

  // Thinking is off for a JSON-producing call. The reasoning arrives as a
  // separate block that has to be discarded anyway, and it spends the token
  // budget that the document needs.
  if (canServe(model, 'thinking')) request.thinking = false;

  return request;
}

export class HeylookClient implements InferenceClient {
  readonly providerId: ProviderId = 'heylook';
  /**
   * Neither wire has a `responseSchema` equivalent, so `enforceSchema` is
   * accepted and has no effect here: the shape is always asked for in the
   * prompt. Declared false so the UI can say so rather than offer a control
   * that silently does nothing.
   */
  readonly canEnforceSchema = false;
  readonly origin: string;
  readonly model: HeylookModel | null;
  private readonly fetchImpl: typeof fetch;
  private readonly backpressureBudgetMs: number;

  constructor(config: HeylookClientConfig = {}) {
    this.origin = config.origin ?? HEYLOOK_INSTANCES[0].origin;
    this.model = config.model ?? null;
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
    this.backpressureBudgetMs = config.backpressureBudgetMs ?? BACKPRESSURE_BUDGET_MS;
  }

  async call<T = unknown>(options: CallOptions): Promise<CallResult<T>> {
    const started = Date.now();

    // One id for the whole call, reused across backpressure retries: only one
    // attempt is ever in flight, so a cancel by this id is unambiguous.
    const requestId = newRequestId();
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      // Deliberately not awaited. The caller is waiting on the aborted fetch,
      // not on this, and a cancel that fails changes nothing they can act on --
      // the run either stops or finishes on its own.
      void this.cancel(requestId);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await this.run<T>(options, requestId, started, () => cancelled);
    } finally {
      // `once: true` removes it on fire; this covers the path where the call
      // completed and nothing ever aborted.
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** The call itself, separated so `call` can own the cancel listener's lifetime. */
  private async run<T>(
    options: CallOptions,
    requestId: string,
    started: number,
    wasCancelled: () => boolean,
  ): Promise<CallResult<T>> {
    const rawImages = options.images ?? [];

    // Gate on what the server says it will serve. This does not make the
    // refusal impossible -- `capabilities` is read from the model directory's
    // config while the refusal is decided from the model as loaded, so a
    // hand-made variant can advertise vision and then decline it -- but it
    // turns the common case into a message that names the fix instead of a 400.
    if (rawImages.length > 0 && this.model != null && !canServe(this.model, 'vision')) {
      throw new ProviderError(
        `${this.model.id} does not serve vision, and this prompt carries ${rawImages.length} ` +
          'reference image(s). Choose a vision model, or remove the images.',
        'unsupported',
      );
    }

    if (options.model != null && options.model !== this.model?.id) {
      // Refused rather than ignored. Gemini resolves `options.model`, so a
      // caller setting it would silently get the requested model on one backend
      // and a different one here -- the exact divergence the shared interface
      // exists to prevent. This client deliberately carries a whole capability
      // row rather than an id, so honouring a bare string would mean gating
      // vision against the wrong model's row.
      throw new ProviderError(
        `This client is bound to ${this.model?.id ?? 'no model'} and cannot switch to ` +
          `${options.model} per call: the capability row it gates on is chosen at construction. ` +
          'Construct another client instead.',
        'unsupported',
      );
    }

    const images = await resizeAll(rawImages);
    if (rawImages.length > 0) {
      // Reported because the resize is why the body's image bytes do not match
      // what the pipeline handed over, and a silent discrepancy in a request
      // log is worse than no log.
      trace('provider', 'provider.resize', `heylook resized ${rawImages.length} image(s) before sending`, {
        before: rawImages.map((i) => ({ mimeType: i.mimeType, base64Chars: i.base64.length })),
        after: images.map((i) => ({ mimeType: i.mimeType, base64Chars: i.base64.length })),
      });
    }

    const request = buildRequest(options, images, this.model);

    // The body as posted, not a re-derivation from `options`: the images above
    // have already been resized by this point, so anything rebuilt from the raw
    // attachments would report the wrong sizes for the one field somebody opens
    // a request log to check.
    trace(
      'provider',
      'provider.wire.request',
      `heylook POST ${this.origin}/v1/messages -- ${this.model?.id ?? 'no model'}`,
      { url: `${this.origin}/v1/messages`, requestId, body: request },
    );

    const body = await this.post(request, requestId, options.signal);

    const status = String(body.stop_reason ?? 'end_turn');
    const text = joinTextBlocks(body.content);
    const messageId = typeof body.id === 'string' ? body.id : undefined;
    const usage = extractUsage(body);

    trace(
      'provider',
      'provider.wire.response',
      `heylook answered stop_reason ${status} -- ${text.length} chars of text`,
      {
        stopReason: status,
        messageId,
        usage,
        // Which block types came back. A thinking model returns a `thinking`
        // block beside `text`, and only `text` is joined -- this is where that
        // is visible rather than merely documented.
        blocks: Array.isArray(body.content)
          ? body.content.map((block) => (block as { type?: unknown })?.type ?? 'unknown')
          : [],
        textLength: text.length,
        // A sibling of `usage`, not a member of it, so `extractUsage` does not
        // reach it and it would otherwise be dropped. Logged and deliberately
        // NOT lifted onto `CallResult`: throughput is this provider's own
        // reporting, and the seam has no such concept to give it.
        //
        // Measured rather than relayed, which is the bar this repo sets for a
        // claim about software it does not control -- AND the numbers travel
        // with their scope, which is the other half of that rule and the half
        // the first version of this comment got wrong. It named a sample
        // without saying what it was a sample OF, which is the misquotation
        // shape: on an older server the same call logs a different thing.
        //
        // Observed here against server 1.79.50, both non-streaming on
        // /v1/messages, same session:
        //   google_gemma_4-E4B-it-bf16-mlx (mlx)  -> prompt_tps 352.6,
        //     generation_tps 100.3, peak_memory_gb 15.94, total_duration_ms
        //     4396, against a 4.40s wall clock.
        //   JonathanColetti_Qwen3.8-27B-...-GGUF  -> peak_memory_gb NULL.
        //
        // The version is read rather than assumed: `GET /v1/capabilities`
        // carries `server_version`, and `GET /openapi.json` carries the same
        // number under `info.version`. Both said 1.79.50. Neither /version nor
        // /health exists, which is what made this look unknowable at first.
        //
        // A NULL HERE HAS TWO DIFFERENT MEANINGS, and the field tells you
        // which. `peak_memory_gb` comes from the MLX engine, so a null on a
        // gguf model is a backend fact and never a version question; a null on
        // an MLX model means a server below 1.79.50, where the non-streaming
        // builder overwrote `performance` with a three-key literal. Reported
        // from a read of the server source, and consistent with both rows
        // above -- the mlx figures are non-null precisely because this is .50.
        //
        // `thinking_duration_ms` and `content_duration_ms` are streaming-only
        // by design and will be null on every call this client makes. Relayed,
        // not tested here. All three nulls are expected, not faults to chase.
        //
        // The two modes also spell absence differently -- streaming omits a
        // null field, non-streaming renders it as an explicit null. Nothing
        // here branches on an inner field, so both spellings already pass
        // through identically; keep it that way rather than adding a check
        // that would have to know which mode produced the object.
        ...(body.performance != null ? { performance: body.performance } : {}),
      },
      { level: status === STOP_TRUNCATED ? 'warn' : 'info' },
    );

    if (status === STOP_TRUNCATED) {
      // Our own flag, never the wire: a cancelled run is indistinguishable from
      // a truncated one in `stop_reason`, and telling someone who pressed stop
      // to raise their token ceiling would be nonsense.
      if (wasCancelled()) throw new DOMException('Aborted', 'AbortError');
      throw new TruncatedError(text, status, messageId);
    }

    let parsed: T | null = null;
    if (options.schema) {
      // The whole cost of asking for a shape rather than constraining it lands
      // here. The schema's own required keys are handed to the extractor so it
      // can tell the document from anything else the model wrapped around it --
      // notably a copy of the schema, which the trailer makes likely and which
      // is longer than any document written against it.
      const slice = extractJsonObject(text, requiredKeys(options.schema));
      trace(
        'provider',
        'provider.parse',
        slice == null
          ? 'heylook: no JSON object could be found in the reply'
          : `heylook: JSON object extracted from ${text.length} chars of reply`,
        {
          // Always this branch here: heylook has no constrained decoding, so
          // the shape was asked for in the prompt whatever `enforceSchema` said.
          branch: 'asked',
          requiredKeys: requiredKeys(options.schema),
          chars: text.length,
          extracted: slice == null ? null : slice.length,
        },
        { level: slice == null ? 'error' : 'info' },
      );
      if (slice == null) {
        throw new ProviderError(
          `No JSON object found in the reply from ${this.model?.id ?? 'heylook'}. This model ` +
            'may not follow a JSON format instruction well enough for the planner; try a ' +
            `larger or instruction-tuned model. Reply began: ${text.slice(0, 200)}`,
          status,
          messageId,
        );
      }
      parsed = JSON.parse(slice) as T;
    }

    return { text, parsed, status, interactionId: messageId, usage, durationMs: Date.now() - started };
  }

  /**
   * Ask the server to stop a run.
   *
   * Best effort by design. A 404 means the id is not in flight -- almost always
   * because it already finished -- which is "too late", not a failure, and
   * nothing the caller can do anything about. The reply is a COUNT rather than
   * a boolean (`{"cancelled": N}`) because client-supplied ids are not assumed
   * unique server-side.
   */
  async cancel(requestId: string): Promise<number> {
    try {
      const response = await this.fetchImpl(`${this.origin}/v1/requests/${requestId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        trace(
          'provider',
          'provider.cancel',
          `heylook DELETE /v1/requests/${requestId} answered ${response.status} -- nothing was stopped`,
          { requestId, status: response.status },
          { level: 'warn' },
        );
        return 0;
      }
      const body = (await response.json()) as { cancelled?: unknown };
      const cancelled = typeof body.cancelled === 'number' ? body.cancelled : 0;
      trace(
        'provider',
        'provider.cancel',
        `heylook cancelled ${cancelled} in-flight request(s)`,
        { requestId, cancelled },
        { level: 'warn' },
      );
      return cancelled;
    } catch {
      // The server may be gone, or this build may predate the endpoint. Either
      // way the generation stops or it does not, and the user has their UI back.
      return 0;
    }
  }

  /**
   * One HTTP round trip, with the queue retried and the status codes kept apart.
   *
   * The 400/500 split is deliberate on the server's side and worth honouring:
   * 400 means pick a different model and is recoverable, 500 means that model
   * is broken and is not.
   */
  private async post(
    request: Record<string, unknown>,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + this.backpressureBudgetMs;
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.send(request, requestId, signal);

      if (response.status === 503) {
        // Backoff, with the header as a floor rather than as the whole answer.
        // Polling every second for the full budget is 300 requests; backing off
        // reaches the same deadline in roughly twenty.
        const wait = Math.min(
          Math.max(retryAfterMs(response.headers.get('Retry-After')), MIN_RETRY_MS) * 2 ** attempt,
          MAX_RETRY_MS,
        );
        trace(
          'provider',
          'provider.backpressure',
          `heylook is busy (503): attempt ${attempt + 1}, waiting ${wait}ms`,
          {
            attempt: attempt + 1,
            retryAfterHeader: response.headers.get('Retry-After'),
            waitMs: wait,
            budgetRemainingMs: Math.max(deadline - Date.now(), 0),
          },
          { level: 'warn' },
        );
        if (Date.now() + wait >= deadline) {
          throw new BackpressureError(
            `heylook was still busy after ${Math.round(this.backpressureBudgetMs / 1000)}s and ` +
              `${attempt + 1} attempts. It runs one generation at a time, so something else is ` +
              'using it -- another tab, or another tool pointed at the same server.',
            wait,
          );
        }
        await delay(wait, signal);
        continue;
      }

      if (!response.ok) {
        const message = await failureMessage(response, this.model);
        trace(
          'provider',
          'provider.http.error',
          `heylook answered ${response.status}`,
          { status: response.status, requestId, message },
          { level: 'error' },
        );
        throw new ProviderError(message, String(response.status));
      }

      try {
        return (await response.json()) as Record<string, unknown>;
      } catch (cause) {
        throw new ProviderError(
          `heylook returned a non-JSON body: ${cause instanceof Error ? cause.message : String(cause)}`,
          String(response.status),
        );
      }
    }
  }

  private async send(
    request: Record<string, unknown>,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.origin}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Echoed back, and how a request is correlated with the server's logs.
          'X-Request-ID': requestId,
        },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      // Same three-way ambiguity as discovery, and the same reason not to
      // default to blaming the server. Discovery runs first and reports it in
      // full, so this one stays short and points there.
      throw new ProviderError(
        `Could not reach heylook at ${this.origin}, with no status to say why. The server may ` +
          'be down, the page policy may have refused the origin, or the server may have ' +
          'answered without CORS headers for this page. Press refresh beside the model picker ' +
          'to run discovery, which reports the three separately.',
        'unreachable',
      );
    }
  }
}

/**
 * The answer, without the reasoning.
 *
 * A thinking model returns a `thinking` block alongside `text`, and the
 * thinking block carries its content under both `thinking` and `text` for
 * backwards compatibility. Reading every block's `text` would therefore pick up
 * the reasoning even from a reader that thought it was filtering.
 */
export function joinTextBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: string; text?: unknown } =>
        block != null && typeof block === 'object' && (block as { type?: unknown }).type === 'text',
    )
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/**
 * `Retry-After` is seconds, or an HTTP date. Both occur; neither is trusted.
 *
 * The case worth naming is a header that is numeric and negative. `Date.parse`
 * accepts `"-1"` as a year, so falling through to the date branch turns it into
 * a time long past and then into a zero wait -- a busy loop against a server
 * that has just said it is saturated. A numeric header is therefore decided by
 * the numeric branch alone, valid or not.
 */
export function retryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_MS;

  const trimmed = header.trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_MS;
    return Math.min(seconds * 1000, MAX_RETRY_MS);
  }

  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_MS);
  }

  return DEFAULT_RETRY_MS;
}

async function failureMessage(response: Response, model: HeylookModel | null): Promise<string> {
  const detail = await readDetail(response);
  const suffix = detail === '' ? '' : ` ${detail}`;

  switch (response.status) {
    case 400:
      return (
        `heylook refused the request${model ? ` for ${model.id}` : ''}. Either the model id is ` +
        `not served any more, or the loaded model declined this input.${suffix}`
      );
    case 401:
    case 403:
      return (
        'heylook refused the request as unauthorised. The server has HEYLOOK_API_KEY set and ' +
        `this build sends no key.${suffix}`
      );
    case 422:
      return `heylook rejected the request body as malformed.${suffix}`;
    case 500:
      return (
        `${model?.id ?? 'That model'} exists but failed to load. It is broken rather than busy, ` +
        `so retrying will not help -- choose another model.${suffix}`
      );
    default:
      return `heylook answered ${response.status}.${suffix}`;
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; error?: { message?: unknown } };
    const detail = body.detail ?? body.error?.message;
    if (typeof detail === 'string') return detail;
    if (detail != null) return JSON.stringify(detail);
  } catch {
    // A body that is not JSON tells us nothing the status has not already said.
  }
  return '';
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The handle a cancel is issued against.
 *
 * Sent as `X-Request-ID`, which the server honours as of 1.79.44 -- before that
 * it generated its own and ignored the header, so the id a client thought it
 * held did not exist server-side.
 */
function newRequestId(): string {
  return `h3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
