/**
 * What goes into the buffer, and what does not.
 *
 * Redaction happens on the way IN rather than at render time, for two reasons
 * that pull the same way. One image is a megabyte of base64, and the buffer
 * evicts by size -- one un-redacted attachment would push out the whole log it
 * was meant to appear in. And the panel has a copy button, so anything that
 * reaches the buffer is a thing someone can paste into a bug report.
 *
 * The API key is not expected here at all: Gemini's goes to the SDK
 * constructor and never appears in a request body, and heylook is sent none.
 * That was checked rather than assumed, and the key patterns below are still
 * applied, because "no caller passes one today" is a claim about callers.
 */

/** Long enough to hold a whole system prompt, which is the point of reading one. */
export const MAX_STRING = 24_000;

/**
 * A summary is one line in a list, so it is capped far shorter than a payload.
 *
 * It needs its own bound because it does not go through `redact` at all -- it
 * is a string the caller composed, concatenated straight into the event. Two
 * call sites interpolate unbounded text into one: the edit instruction in
 * `pipeline.ts` and the setting value in `db/db.ts`. Without this, a 200 KB
 * instruction was truncated inside `detail` and kept whole in `summary`, which
 * defeated the per-event cap and made `MAX_EVENT_BYTES` a bound on part of an
 * event rather than on an event.
 */
export const MAX_SUMMARY = 300;

/** Below this, an unbroken run of base64 characters is more likely to be an id. */
const BASE64_MIN = 512;

/** A single token of base64: no spaces, so no sentence can be mistaken for one. */
const BASE64_LIKE = /^[A-Za-z0-9+/=\r\n]+$/;

/**
 * Field names whose value is never printed.
 *
 * Bare `key` is deliberately NOT here. In this app that name belongs to the
 * settings store -- `setSetting('provider', ...)` logs `key: "provider"` -- and
 * redacting it would blind the storage channel to which setting changed, in
 * exchange for hiding nothing, since no secret travels under that name.
 */
const SECRET_KEY = /^(?:api[-_]?key|x-api-key|authorization|token|secret|password|passphrase|credential)$/i;

/** Field names that carry an encoded attachment on one wire or the other. */
const BLOB_KEY = /^(?:data|base64|dataurl|data_url)$/i;

/**
 * A JSON-safe, size-bounded copy.
 *
 * Total rather than throwing: this runs on the way to a log, and a log that
 * can fail is a log that takes down the thing it was watching. Anything it
 * cannot represent becomes a string saying so.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value ?? null;

  const type = typeof value;
  if (type === 'string') return redactString(value as string);
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return `${(value as bigint).toString()}n`;
  if (type === 'function') return `[function ${(value as { name?: string }).name || 'anonymous'}]`;
  if (type === 'symbol') return String(value);

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === 'object') {
    // A cycle is not a hypothetical: a React state object or a DOM-adjacent
    // value reaching here would hang the walk rather than report anything.
    //
    // Scoped to the current PATH, not to everything visited: the set is added
    // to on the way down and removed from on the way back up. Without the
    // removal, the same object appearing twice as siblings -- `{x: s, y: s}`,
    // or the same row in two arrays -- reported the second one as `[circular]`,
    // which is a flatly false label on a payload that has no cycle.
    if (seen.has(value)) return '[circular]';
    seen.add(value);

    try {
      if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));

      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as object)) {
        if (SECRET_KEY.test(key)) {
          out[key] = '[redacted]';
          continue;
        }
        if (BLOB_KEY.test(key) && typeof entry === 'string') {
          out[key] = elide(entry);
          continue;
        }
        out[key] = redact(entry, seen);
      }
      return out;
    } finally {
      seen.delete(value);
    }
  }

  return String(value);
}

/**
 * Strings are the only thing with two failure modes, so they get their own pass.
 *
 * The base64 check is the safety net under `BLOB_KEY`: it catches an attachment
 * arriving under a field name a future wire spells differently, and it cannot
 * fire on prose, because a base64 run contains no spaces and a system prompt
 * does.
 */
function redactString(value: string): string {
  if (value.length >= BASE64_MIN && BASE64_LIKE.test(value)) return elide(value);
  if (value.length > MAX_STRING) {
    return `${value.slice(0, MAX_STRING)}\n[... ${value.length - MAX_STRING} more characters]`;
  }
  return value;
}

/** One line, bounded, with the tail replaced by a count rather than dropped. */
export function capSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY) return summary;
  return `${summary.slice(0, MAX_SUMMARY)}... (+${summary.length - MAX_SUMMARY} more characters)`;
}

function elide(value: string): string {
  return `[elided: ${value.length} characters of encoded data]`;
}

/**
 * How much of the buffer's budget an event occupies.
 *
 * Serialized length rather than a real heap measurement, which is not reachable
 * from a page. It is the right proxy anyway: the budget exists to bound what
 * the copy button produces and what a retained payload costs, and both are the
 * serialized form.
 */
export function weigh(detail: unknown, summary: string): number {
  let payload = 0;
  try {
    payload = detail === undefined ? 0 : JSON.stringify(detail)?.length ?? 0;
  } catch {
    // Redaction should have made this impossible; charge something anyway
    // rather than letting an unweighable event sit in the buffer for free.
    payload = 1024;
  }
  return payload + summary.length;
}
