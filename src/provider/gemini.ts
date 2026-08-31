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
 *    temperature control in the UI. This is a fact about THIS API, not a house
 *    rule: heylook honours temperature, so the ban does not travel.
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
import {
  extractUsage,
  ProviderError,
  TruncatedError,
  type CallOptions,
  type CallResult,
  type InferenceClient,
  type ProviderId,
  type Task,
} from './types';

export type { ImageAttachment } from './types';
export { dataUrlToAttachment } from './types';

import { extractJsonObject, requiredKeys, withShapeTrailer } from './shape';
import { trace } from '../debug';

/** The one host this client contacts. Named here so the CSP can be read against it. */
export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

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
 * are narrow rewrites of a named field, so they sit at the floor.
 *
 * Thinking is not free even at the floor: probed at 48 thought tokens for
 * "17 * 23" at `low` versus 153 at `high`, billed at the output rate and
 * reported under `usage.total_thought_tokens`.
 *
 * This lives inside the Gemini client now rather than on the shared options,
 * because the mapping from a task to a depth is a per-backend decision and the
 * spellings do not line up: heylook takes a boolean plus a per-model
 * `reasoning_effort` vocabulary.
 */
export const THINKING: Record<Task, ThinkingLevel> = {
  planner: 'medium',
  patch: 'low',
};

const TERMINAL_OK = 'completed';
const TERMINAL_TRUNCATED = 'incomplete';
const TERMINAL_FAILED = new Set(['failed', 'cancelled', 'budget_exceeded']);

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
    // When enforcement is off the shape has to be asked for in words instead,
    // and it is the same trailer the local client uses -- see ./shape.ts.
    system_instruction: enforcing(options)
      ? options.systemInstruction
      : withShapeTrailer(options.systemInstruction, options.schema),
    generation_config: {
      // Always stated. Unset bills thinking at the output rate.
      thinking_level: THINKING[options.task],
      ...(options.maxOutputTokens != null ? { max_output_tokens: options.maxOutputTokens } : {}),
      ...(options.seed != null ? { seed: options.seed } : {}),
      // temperature is deliberately absent -- accepted and silently ignored.
    },
  };

  if (enforcing(options)) {
    // Constrained decoding, and now only when asked for. It makes the planner's
    // large nested document parse by construction, at a cost this project cares
    // about: it distorts the token distribution while the model is writing, and
    // the prose is the product. `response_format` is where the interface's
    // provider-neutral `enforceSchema` becomes this wire's own word for it, and
    // that translation happens here and nowhere earlier.
    request.response_format = {
      type: 'text',
      mime_type: 'application/json',
      schema: options.schema,
    };
  }

  return request;
}

/** Enforcement needs both a shape to enforce and permission to enforce it. */
function enforcing(options: CallOptions): boolean {
  return options.schema != null && options.enforceSchema !== false;
}

export class GeminiClient implements InferenceClient {
  readonly providerId: ProviderId = 'gemini';
  /** `response_format` with a schema is genuinely enforced here, unlike heylook. */
  readonly canEnforceSchema = true;
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

    // The body itself, not a re-derivation of it. The decorator in
    // `src/debug/instrument.ts` records what the pipeline asked for; this is
    // what actually goes on the wire, which is where `store: false`, the
    // thinking level and the presence or absence of `response_format` become
    // visible. The API key is not in here -- it went to the SDK constructor.
    trace(
      'provider',
      'provider.wire.request',
      `gemini POST interactions.create -- ${String(request.model)}, thinking ${THINKING[options.task]}` +
        `, ${request.response_format ? 'schema enforced' : 'shape asked for in the prompt'}`,
      { origin: GEMINI_ORIGIN, body: request },
    );

    const interaction = await this.ai.interactions.create(
      request as never,
      options.signal ? ({ signal: options.signal } as never) : undefined,
    );

    const status = String((interaction as { status?: unknown }).status ?? 'unknown');
    const text = String((interaction as { output_text?: unknown }).output_text ?? '');
    const interactionId = (interaction as { id?: string }).id;
    const usage = extractUsage(interaction);

    // Emitted before the status checks below, so a truncation or a failure is
    // still reported with its usage and its id rather than only as a thrown
    // error the decorator sees.
    trace(
      'provider',
      'provider.wire.response',
      `gemini answered ${status} -- ${text.length} chars`,
      { status, interactionId, usage, textLength: text.length },
      { level: status === TERMINAL_OK ? 'info' : 'warn' },
    );

    if (status === TERMINAL_TRUNCATED) {
      throw new TruncatedError(text, status, interactionId);
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
      if (enforcing(options)) {
        // Decoding was constrained, so anything but clean JSON is the API
        // breaking its own guarantee and deserves to be loud.
        try {
          parsed = JSON.parse(text) as T;
          trace('provider', 'provider.parse', 'gemini: constrained decoding, parsed the reply whole', {
            branch: 'enforced',
            chars: text.length,
          });
        } catch (cause) {
          throw new ProviderError(
            `Reply was not valid JSON despite a response schema: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
            status,
            interactionId,
          );
        }
      } else {
        // Asked rather than enforced, so the same defensive read the local
        // client uses. A model free to write prose will sometimes wrap it.
        const slice = extractJsonObject(text, requiredKeys(options.schema));
        trace(
          'provider',
          'provider.parse',
          slice == null
            ? 'gemini: enforcement off, and no JSON object could be found in the reply'
            : `gemini: enforcement off, JSON object extracted from ${text.length} chars of reply`,
          {
            branch: 'asked',
            requiredKeys: requiredKeys(options.schema),
            chars: text.length,
            extracted: slice == null ? null : slice.length,
          },
          { level: slice == null ? 'error' : 'info' },
        );
        if (slice == null) {
          throw new ProviderError(
            'No JSON object found in the reply. Schema enforcement is switched off for this ' +
              `call, so the shape was requested in the prompt rather than imposed. Reply began: ${text.slice(0, 200)}`,
            status,
            interactionId,
          );
        }
        parsed = JSON.parse(slice) as T;
      }
    }

    return { text, parsed, status, interactionId, usage, durationMs: Date.now() - started };
  }
}
