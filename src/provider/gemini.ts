/**
 * The Gemini Interactions API client.
 *
 * Deliberately narrow: one call shape, no streaming, no tools, no agents. Every
 * constant below was verified against the generated SDK types at
 * @google/genai 2.17.1 or probed live, not taken from documentation -- the docs,
 * the OpenAPI spec and the generated types each turned out to be wrong about
 * something material in this API.
 *
 * Load-bearing findings encoded here:
 *
 *  - `temperature` is in the type and is silently ignored (accepted with a
 *    `completed` status and no effect). It is never sent, and there is no
 *    temperature control in the UI.
 *  - Thinking runs by DEFAULT and bills at the output rate. An unset
 *    `thinking_level` is the EXPENSIVE path, so every call states one. The SDK's
 *    level union is broader than any one model accepts -- see ThinkingLevel.
 *  - `system_instruction` and `generation_config` are interaction-scoped. A
 *    follow-up that omits them silently runs with neither, so both are sent on
 *    every call without exception.
 *  - `interactions.delete` returns 501. Anything sent with `store: true` is
 *    retained for the full project window and cannot be purged, so `store` is
 *    hard-wired false. That also rules out `previous_interaction_id` chaining;
 *    every call is standalone and carries the document as its own context.
 *  - `status: "incomplete"` means truncated at max_output_tokens. It is terminal
 *    and distinct from failure, and for a JSON-producing planner it is the
 *    likeliest failure mode of all.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Thinking levels this model accepts.
 *
 * The SDK type is `minimal | low | medium | high` -- that is the union across
 * ALL models, not a per-model list. Probed live against gemini-3.7-flash:
 *
 *   minimal -> 400 "'minimal' is not a supported thinking level for this model.
 *                   Allowed values are: high, low, medium."
 *   low, medium, high -> accepted
 *
 * So `low` is the floor here, not `minimal`, and the type is narrowed to make
 * the rejected value unrepresentable. Widen it only alongside a model that
 * accepts it -- gemini-bridge defaults to `minimal`, but that was calibrated
 * against 3.6-flash.
 */
export type ThinkingLevel = 'low' | 'medium' | 'high';

/** Both `models/gemini-3.7-flash` and the bare id work; probed. */
export const DEFAULT_MODEL = 'models/gemini-3.7-flash';

/**
 * Per-task thinking levels.
 *
 * Planning is the only stage that genuinely benefits from deliberation. Patches
 * are narrow rewrites of a named field, and vision descriptions are close to
 * transcription, so both sit at the floor.
 *
 * Thinking is not free even at the floor: probed at 48 thought tokens for
 * "17 * 23" at `low` versus 153 at `high`, billed at the output rate and
 * reported under `usage.total_thought_tokens`.
 */
export const THINKING: Record<'planner' | 'patch' | 'vision', ThinkingLevel> = {
  planner: 'medium',
  patch: 'low',
  vision: 'low',
};

const TERMINAL_OK = 'completed';
const TERMINAL_TRUNCATED = 'incomplete';
const TERMINAL_FAILED = new Set(['failed', 'cancelled', 'budget_exceeded']);

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
 */
export class TruncatedError extends ProviderError {
  constructor(
    readonly partialText: string,
    interactionId?: string,
  ) {
    super(
      `Model output was truncated at max_output_tokens (${partialText.length} chars returned). ` +
        'Raise maxOutputTokens or narrow the request.',
      TERMINAL_TRUNCATED,
      interactionId,
    );
    this.name = 'TruncatedError';
  }
}

export interface ImageAttachment {
  /** Raw base64, without the `data:` prefix. */
  base64: string;
  mimeType: string;
}

export interface CallOptions {
  systemInstruction: string;
  prompt: string;
  thinkingLevel: ThinkingLevel;
  maxOutputTokens?: number;
  /** JSON Schema. When present the reply is forced to conform. */
  schema?: Record<string, unknown>;
  /** Makes a rerun that differs a real difference rather than sampling noise. */
  seed?: number;
  /** Images travel inline as base64; nothing is uploaded and nothing is left behind. */
  images?: ImageAttachment[];
  model?: string;
  signal?: AbortSignal;
}

export interface CallResult<T = unknown> {
  text: string;
  parsed: T | null;
  status: string;
  interactionId?: string;
  usage: Record<string, unknown>;
  durationMs: number;
}

export interface GeminiClientConfig {
  apiKey: string;
  model?: string;
}

/**
 * Assemble the request body.
 *
 * Extracted as a pure function so the privacy-critical parts can be asserted
 * without a network call or a key. `store: false` in particular is a guarantee,
 * not a preference -- `interactions.delete` returns 501, so anything stored is
 * retained for the full project window and can never be purged. There is no
 * option to change it, and test/provider.test.ts fails the build if it is ever
 * anything but false.
 */
export function buildRequest(options: CallOptions, defaultModel: string): Record<string, unknown> {
  // Media first, then the question: the prompt then reads as instructions
  // about material already presented.
  const input: Record<string, unknown>[] = [];
  for (const image of options.images ?? []) {
    input.push({ type: 'image', data: image.base64, mime_type: image.mimeType });
  }
  input.push({ type: 'text', text: options.prompt });

  const request: Record<string, unknown> = {
    model: options.model ?? defaultModel,
    input,
    // Not configurable. See above.
    store: false,
    // Interaction-scoped: omitting it on any call runs with no system prompt.
    system_instruction: options.systemInstruction,
    generation_config: {
      // Always stated. Unset bills thinking at the output rate.
      thinking_level: options.thinkingLevel,
      ...(options.maxOutputTokens != null ? { max_output_tokens: options.maxOutputTokens } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
      // temperature is deliberately absent -- accepted and silently ignored.
    },
  };

  if (options.schema) {
    request.response_format = {
      type: 'text',
      mime_type: 'application/json',
      schema: options.schema,
    };
  }

  return request;
}

export class GeminiClient {
  private readonly ai: GoogleGenAI;
  private readonly defaultModel: string;

  constructor(config: GeminiClientConfig) {
    if (!config.apiKey) throw new Error('GeminiClient requires an API key.');
    this.ai = new GoogleGenAI({ apiKey: config.apiKey });
    this.defaultModel = config.model ?? DEFAULT_MODEL;
  }

  async call<T = unknown>(options: CallOptions): Promise<CallResult<T>> {
    const started = Date.now();
    const request = buildRequest(options, this.defaultModel);

    const interaction = await this.ai.interactions.create(
      request as never,
      options.signal ? ({ signal: options.signal } as never) : undefined,
    );

    const status = String((interaction as { status?: unknown }).status ?? 'unknown');
    const text = String((interaction as { output_text?: unknown }).output_text ?? '');
    const interactionId = (interaction as { id?: string }).id;
    const usage = extractUsage(interaction);

    if (status === TERMINAL_TRUNCATED) {
      throw new TruncatedError(text, interactionId);
    }
    if (TERMINAL_FAILED.has(status)) {
      throw new ProviderError(`Interaction ${status}. No output was produced.`, status, interactionId);
    }
    if (status !== TERMINAL_OK) {
      // in_progress / queued / requires_action should be unreachable without
      // background execution, which this client does not use. Surfacing it is
      // better than treating an unlabelled state as success.
      throw new ProviderError(`Unexpected non-terminal status "${status}".`, status, interactionId);
    }

    let parsed: T | null = null;
    if (options.schema) {
      try {
        parsed = JSON.parse(text) as T;
      } catch (cause) {
        throw new ProviderError(
          `Reply was not valid JSON despite a response schema: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
          status,
          interactionId,
        );
      }
    }

    return { text, parsed, status, interactionId, usage, durationMs: Date.now() - started };
  }
}

function extractUsage(interaction: unknown): Record<string, unknown> {
  const usage = (interaction as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return {};
  return Object.fromEntries(Object.entries(usage as object).filter(([, v]) => v != null));
}

/** Split a `data:image/png;base64,...` URL into the parts the API wants. */
export function dataUrlToAttachment(dataUrl: string): ImageAttachment | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}
