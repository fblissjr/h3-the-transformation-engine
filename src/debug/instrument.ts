/**
 * The provider-neutral half of the trace, and the only half that is by
 * construction.
 *
 * A decorator on `InferenceClient` sees exactly what the pipeline handed over
 * and exactly what came back, for every backend that exists and every backend
 * that will. It needs no cooperation from the client, so a provider added
 * tomorrow is traced the day it is written, with nothing to remember.
 *
 * What it cannot see is everything below the seam: the wire body each client
 * assembles, heylook's 503 queue, the cancel call, which JSON-extraction branch
 * ran. Those are emitted by the clients themselves, on the `provider` channel
 * beside these. THAT half is a maintained list -- a new client that emits
 * nothing shows the neutral record and no wire body, and the difference is
 * invisible from the panel unless you know to look. Said here rather than left
 * to read as one uniform guarantee.
 *
 * Correlation is by time order, and that is sound for a reason held up
 * elsewhere: `generate` and `applyAssisted` both return early while `busy` is
 * set and share one abort controller, so exactly one call is ever in flight.
 * See `describeConcurrency` in `../provider/registry.ts` -- the policy's
 * concurrency attribute does not gate this, the single-flight guard does.
 */

import type { CallOptions, CallResult, InferenceClient } from '../provider/types';
import { trace } from './bus';

/** Roughly what the base64 decodes to; the exact figure is not worth a decode. */
function approximateBytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/** The request, as the seam describes it -- no wire spelling, no provider words. */
function describeCall(client: InferenceClient, options: CallOptions): Record<string, unknown> {
  return {
    provider: client.providerId,
    task: options.task,
    ...(options.model != null ? { model: options.model } : {}),
    canEnforceSchema: client.canEnforceSchema,
    enforceSchema: options.enforceSchema ?? true,
    schemaRequested: options.schema != null,
    ...(options.maxOutputTokens != null ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.seed != null ? { seed: options.seed } : {}),
    aborted: options.signal?.aborted ?? false,
    images: (options.images ?? []).map((image) => ({
      mimeType: image.mimeType,
      bytes: approximateBytes(image.base64),
    })),
    systemInstruction: options.systemInstruction,
    prompt: options.prompt,
  };
}

function describeResult(result: CallResult<unknown>): Record<string, unknown> {
  return {
    status: result.status,
    ...(result.interactionId ? { interactionId: result.interactionId } : {}),
    clientDurationMs: result.durationMs,
    usage: result.usage,
    textLength: result.text.length,
    parsed: result.parsed == null ? null : Object.keys(result.parsed as object),
    text: result.text,
  };
}

/**
 * Anything a client can throw, flattened without losing what makes it useful.
 *
 * `TruncatedError` carries partial text and `BackpressureError` a wait, and
 * both are read off the instance rather than by importing the classes, so this
 * stays a decorator over the interface rather than a thing that knows the
 * error taxonomy.
 */
function describeFailure(cause: unknown): Record<string, unknown> {
  if (!(cause instanceof Error)) return { thrown: String(cause) };
  const extras = cause as unknown as {
    status?: unknown;
    interactionId?: unknown;
    partialText?: unknown;
    retryAfterMs?: unknown;
  };
  return {
    name: cause.name,
    message: cause.message,
    ...(extras.status != null ? { status: extras.status } : {}),
    ...(extras.interactionId != null ? { interactionId: extras.interactionId } : {}),
    ...(typeof extras.partialText === 'string'
      ? { partialTextLength: extras.partialText.length, partialText: extras.partialText }
      : {}),
    ...(extras.retryAfterMs != null ? { retryAfterMs: extras.retryAfterMs } : {}),
  };
}

function isAbort(cause: unknown): boolean {
  return (
    (cause instanceof DOMException && cause.name === 'AbortError') ||
    (cause instanceof Error && cause.name === 'AbortError')
  );
}

/**
 * Wrap a client so every call it makes is recorded.
 *
 * Returns a new object rather than mutating, so the same underlying client can
 * be used untraced -- which is what every test that is not about tracing does.
 */
export function instrument(client: InferenceClient): InferenceClient {
  return {
    providerId: client.providerId,
    canEnforceSchema: client.canEnforceSchema,
    async call<T>(options: CallOptions): Promise<CallResult<T>> {
      const started = Date.now();
      trace(
        'provider',
        'provider.request',
        `${client.providerId} ${options.task}: ${options.prompt.length} char prompt` +
          `${(options.images ?? []).length > 0 ? `, ${options.images!.length} image(s)` : ''}`,
        describeCall(client, options),
      );

      try {
        const result = await client.call<T>(options);
        trace(
          'provider',
          'provider.response',
          `${client.providerId} ${options.task}: ${result.status}, ${result.text.length} chars`,
          describeResult(result),
          { durationMs: Date.now() - started },
        );
        return result;
      } catch (cause) {
        const aborted = isAbort(cause);
        trace(
          'provider',
          aborted ? 'provider.aborted' : 'provider.error',
          aborted
            ? `${client.providerId} ${options.task}: stopped by the user`
            : `${client.providerId} ${options.task}: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
          describeFailure(cause),
          { level: aborted ? 'warn' : 'error', durationMs: Date.now() - started },
        );
        throw cause;
      }
    },
  };
}
