/**
 * What a debug event is.
 *
 * One flat shape rather than a discriminated union per channel. The panel
 * renders every event the same way -- a row and an expandable payload -- so a
 * union would buy exhaustiveness checks on a switch nothing performs, at the
 * cost of a type edit every time a layer wants to say something new. The
 * channel is what the filter reads; `event` is the dotted name, and it is
 * free-form on purpose.
 */

/**
 * The layer an event came from.
 *
 * Four, because these are the four places a question about "what is it doing"
 * lands: the model call, the compiler around it, the app state that decided to
 * make the call, and what was written to disk afterwards.
 */
export type DebugChannel = 'provider' | 'pipeline' | 'state' | 'storage';

export const DEBUG_CHANNELS: readonly DebugChannel[] = [
  'provider',
  'pipeline',
  'state',
  'storage',
] as const;

/**
 * Three levels, and `warn` is not a hedge.
 *
 * `error` is a call that failed. `warn` is a thing that went differently but
 * not wrongly -- a 503 retry, an abort, a document that would not parse but was
 * still opened. The validator has no warning severity and should not grow one;
 * that rule is about diagnostics on a document, and this is a log about a
 * process, where "it queued four times" is exactly the report worth making.
 */
export type DebugLevel = 'info' | 'warn' | 'error';

export interface DebugEvent {
  /** Monotonic within a page load. The panel's stable key, and the sort order. */
  seq: number;
  at: number;
  channel: DebugChannel;
  /** Dotted name, e.g. `provider.request`, `pipeline.compile.done`. */
  event: string;
  /** One line, for the collapsed row. Never the place to put a payload. */
  summary: string;
  level: DebugLevel;
  /** Wall clock for the thing being reported, where it had a duration. */
  durationMs?: number;
  /** Redacted and JSON-safe by the time it reaches here. See `redact.ts`. */
  detail?: unknown;
  /** What this event costs the buffer, so eviction is by size and not by count alone. */
  bytes: number;
}

/** What a caller supplies; the bus stamps the rest. */
export type DebugRecord = Omit<DebugEvent, 'seq' | 'at' | 'bytes'>;
