/**
 * The seam between the pipeline and whatever is doing inference.
 *
 * Extracted from what `pipeline.ts` actually uses, which is one method taking
 * one options bag. Nothing here describes a transport, a wire format or an
 * SDK; those are the clients' business, and the two that exist disagree about
 * all three.
 *
 * Two fields were deliberately re-framed on the way out of `gemini.ts`, because
 * carrying them across unchanged would have made one provider's mechanism into
 * the interface's vocabulary:
 *
 *  - `schema` is a REQUEST FOR JSON, not a claim about how it is obtained.
 *    Gemini honours it with `response_format` and constrained decoding. heylook
 *    has no equivalent -- there is no `responseSchema` on either of its wires --
 *    so it honours the same field by naming the shape in the prompt and parsing
 *    defensively. Either way `CallResult.parsed` is populated or the call
 *    throws, so `compile` and `edit` never branch on which backend they have,
 *    and `PlannerOutputSchema.safeParse` stays the single trust boundary.
 *
 *  - `task` replaced `thinkingLevel`. `low | medium | high` is Gemini's
 *    vocabulary for a Gemini field. heylook takes a boolean `thinking` plus a
 *    `reasoning_effort` whose accepted values differ per model. Naming the task
 *    and letting each client map it means neither provider's spelling leaks
 *    into the other's call site.
 */

/** Images travel inline as base64; nothing is uploaded and nothing is left behind. */
export interface ImageAttachment {
  /** Raw base64, without the `data:` prefix. Both wires want it this way. */
  base64: string;
  mimeType: string;
}

/**
 * What the call is for, not how hard to think about it.
 *
 * There were three of these when the level lived on the interface. `vision` had
 * no caller -- images ride along with a planner call rather than getting one of
 * their own -- so it is not carried across. Add it back alongside the code that
 * would pass it.
 */
export type Task = 'planner' | 'patch';

export interface CallOptions {
  systemInstruction: string;
  prompt: string;
  task: Task;
  maxOutputTokens?: number;
  /** JSON Schema. When present the reply must be JSON of this shape. */
  schema?: Record<string, unknown>;
  /**
   * Whether to make the backend ENFORCE that shape, where it can.
   *
   * One name, all the way down, and it stays this name until a client turns it
   * into whatever its own wire calls the thing -- `response_format` on Gemini,
   * nothing at all on heylook today. The UI, the engine state, the pipeline and
   * this interface all say `enforceSchema`, so adding a third backend that
   * calls it `grammar` or `json_schema` adds one mapping at that client rather
   * than a fourth vocabulary for everyone upstream to learn.
   *
   * Independent of `schema`: the schema says what shape, this says how hard to
   * insist. With it off, a client asks for the shape in the prompt and parses
   * defensively -- see `../shape.ts`. A client whose `canEnforceSchema` is
   * false ignores this and always takes that path.
   *
   * It is a per-call choice rather than a setting because the trade is real in
   * both directions: constrained decoding distorts the token distribution while
   * the model writes, which costs prose quality, and prose quality is what this
   * project exists to produce.
   */
  enforceSchema?: boolean;
  /** Makes a rerun that differs a real difference rather than sampling noise. */
  seed?: number;
  images?: ImageAttachment[];
  model?: string;
  signal?: AbortSignal;
}

export interface CallResult<T = unknown> {
  text: string;
  parsed: T | null;
  status: string;
  /**
   * Present only where the backend assigns one. Gemini returns an interaction
   * id; heylook returns a message id, and the app sends its own `X-Request-ID`
   * to correlate its logs. Callers treat it as an opaque audit handle.
   */
  interactionId?: string;
  usage: Record<string, unknown>;
  durationMs: number;
}

/** Every backend this app talks to, reduced to the one thing the pipeline needs. */
export interface InferenceClient {
  /** Names the backend for error messages and the UI. */
  readonly providerId: ProviderId;
  /**
   * Whether this backend can constrain decoding to a schema at all.
   *
   * Declared rather than inferred from `providerId`, so the UI can offer the
   * toggle honestly instead of holding a list of which providers support what.
   * A client that says false is not obliged to fail when `enforceSchema` is
   * set -- it asks in the prompt instead, which is a weaker guarantee and a
   * working call.
   */
  readonly canEnforceSchema: boolean;
  call<T = unknown>(options: CallOptions): Promise<CallResult<T>>;
}

export type ProviderId = 'gemini' | 'heylook';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: string,
    readonly interactionId?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Truncation gets its own error carrying the partial text.
 *
 * Throwing a bare failure here would discard both the partial output and the
 * interaction id, and the interaction is billed by then. Callers that can use a
 * partial result, or want to retry with a higher ceiling, need both.
 *
 * Both backends can produce it, from different signals: Gemini reports
 * `status: "incomplete"`, heylook reports `stop_reason: "max_tokens"`. They
 * mean the same thing to a caller, so they raise the same error.
 */
export class TruncatedError extends ProviderError {
  constructor(
    readonly partialText: string,
    status: string,
    interactionId?: string,
  ) {
    super(
      `Model output was truncated at max_output_tokens (${partialText.length} chars returned). ` +
        'Raise maxOutputTokens or narrow the request.',
      status,
      interactionId,
    );
    this.name = 'TruncatedError';
  }
}

/**
 * The server is busy, not broken.
 *
 * Distinct from `ProviderError` because the response is different in kind: a
 * local single-user server serialises generation and answers 503 with
 * `Retry-After` when something else is already running. That is a queue, and
 * the client retries it. Collapsing it into a failure would surface normal
 * operation as an error the user is asked to act on.
 */
export class BackpressureError extends ProviderError {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message, '503');
    this.name = 'BackpressureError';
  }
}

/** Split a `data:image/png;base64,...` URL into the parts both wires want. */
export function dataUrlToAttachment(dataUrl: string): ImageAttachment | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

/**
 * Non-null usage fields, whatever the backend called the container.
 *
 * One implementation because there was nearly two: an identical copy of this
 * had been written into each client, differing only in how `usage` was reached.
 * The house rule that caught it says a change to how usage is normalized would
 * otherwise land in one copy and the two providers would start reporting
 * differently, with both looking correct in isolation.
 */
export function extractUsage(container: unknown): Record<string, unknown> {
  const usage = (container as { usage?: unknown })?.usage;
  if (!usage || typeof usage !== 'object') return {};
  return Object.fromEntries(Object.entries(usage as object).filter(([, v]) => v != null));
}
