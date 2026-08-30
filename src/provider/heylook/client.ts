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
 *  - **503 is normal.** The server serialises generation for one user, so
 *    queueing behind a long request is expected operation, not an outage. It is
 *    retried on `Retry-After` rather than surfaced.
 *  - **`max_tokens` is optional here**, unlike Anthropic's required field.
 *    Absent means the server's sampler cascade decides. The planner and patch
 *    ceilings are real opinions so they are sent; nothing else is invented.
 *  - **`thinking` is a bool**, not Anthropic's config object -- it is the local
 *    template's `enable_thinking` switch, a different mechanism with the same
 *    name. Depth is `reasoning_effort`, whose accepted values are per-model, so
 *    it is only sent when the row advertises the capability.
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
  ProviderError,
  TruncatedError,
  type CallOptions,
  type CallResult,
  type ImageAttachment,
  type InferenceClient,
  type ProviderId,
} from '../types';
import { HEYLOOK_ORIGIN } from './config';
import { extractJsonObject, withShapeTrailer } from './json';
import { canServe, type HeylookModel } from './models';
import { resizeAll } from './images';

/** Anthropic's vocabulary; only `end_turn` and `max_tokens` occur in practice. */
const STOP_TRUNCATED = 'max_tokens';

/** A queued request is retried this many times before it becomes an error. */
const MAX_RETRIES = 3;
/** Used when a 503 arrives without a usable `Retry-After`. */
const DEFAULT_RETRY_MS = 2000;
/** Nothing waits longer than this for one attempt, however large `Retry-After` is. */
const MAX_RETRY_MS = 30_000;

export interface HeylookClientConfig {
  /** Defaults to the build-time origin, which is also what the CSP names. */
  origin?: string;
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
  readonly origin: string;
  readonly model: HeylookModel | null;

  constructor(config: HeylookClientConfig = {}) {
    this.origin = config.origin ?? HEYLOOK_ORIGIN;
    this.model = config.model ?? null;
  }

  async call<T = unknown>(options: CallOptions): Promise<CallResult<T>> {
    const started = Date.now();
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

    const images = await resizeAll(rawImages);
    const request = buildRequest(options, images, this.model);
    const body = await this.post(request, options.signal);

    const status = String(body.stop_reason ?? 'end_turn');
    const text = joinTextBlocks(body.content);
    const messageId = typeof body.id === 'string' ? body.id : undefined;
    const usage = extractUsage(body);

    if (status === STOP_TRUNCATED) {
      throw new TruncatedError(text, status, messageId);
    }

    let parsed: T | null = null;
    if (options.schema) {
      // The whole cost of having no constrained decoding lands here.
      const slice = extractJsonObject(text);
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
   * One HTTP round trip, with the queue retried and the status codes kept apart.
   *
   * The 400/500 split is deliberate on the server's side and worth honouring:
   * 400 means pick a different model and is recoverable, 500 means that model
   * is broken and is not.
   */
  private async post(
    request: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.send(request, signal);

      if (response.status === 503) {
        const wait = retryAfterMs(response.headers.get('Retry-After'));
        if (attempt >= MAX_RETRIES) {
          throw new BackpressureError(
            `heylook is still busy after ${MAX_RETRIES + 1} attempts. It runs one generation at ` +
              'a time, so something else is using it. Try again shortly.',
            wait,
          );
        }
        await delay(wait, signal);
        continue;
      }

      if (!response.ok) {
        throw new ProviderError(await failureMessage(response, this.model), String(response.status));
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

  private async send(request: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetch(`${this.origin}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Echoed back, and how a request is correlated with the server's logs.
          'X-Request-ID': requestId(),
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

function extractUsage(body: Record<string, unknown>): Record<string, unknown> {
  const usage = body.usage;
  if (!usage || typeof usage !== 'object') return {};
  return Object.fromEntries(Object.entries(usage as object).filter(([, v]) => v != null));
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

function requestId(): string {
  return `h3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
