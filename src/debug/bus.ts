/**
 * The event buffer every layer writes to.
 *
 * A module-level sink rather than something threaded through the call graph.
 * Tracing is genuinely ambient -- the alternative is a logger parameter on
 * `compile`, on `InferenceClient.call`, on `saveDocument` and on every UI
 * action, which changes eight signatures to observe them. It stays honest
 * because the sink is pure: no DOM, no network, no storage, resettable, and
 * inert if nothing subscribes.
 *
 * It records whether or not the panel is open. That is the whole point --
 * generate first, wonder what happened second -- and it is why the buffer is
 * bounded by bytes rather than left to grow.
 *
 * IN MEMORY ONLY. Nothing here is written to IndexedDB, and it must stay that
 * way: a persisted log would become a fourth thing `src/db/wipe.ts` has to
 * survey and erase, and would put prompts in storage that the erase button
 * reports counts for. The log dies on reload, which is a design decision and
 * not an oversight.
 */

import { capSummary, redact, weigh } from './redact';
import type { DebugChannel, DebugEvent, DebugLevel, DebugRecord } from './types';

/** A ceiling on rows, so the panel stays scrollable. */
export const MAX_EVENTS = 800;
/**
 * A ceiling on retained payload.
 *
 * Two planner calls carry roughly 50 KB of prompt between them, so this holds a
 * long session. It is the binding limit rather than `MAX_EVENTS`, because the
 * events worth keeping are the large ones.
 */
export const MAX_BYTES = 4_000_000;
/**
 * A ceiling on any ONE event, which is what makes eviction sane.
 *
 * Without it a single payload larger than the whole budget forces a choice
 * between emptying the buffer and exceeding the limit, and the first version
 * here did a third thing: kept the oversized event until literally anything
 * else arrived, then dropped it. Capping the event instead means the budget is
 * always satisfiable by dropping oldest-first, and a pathological payload
 * degrades to a note about itself rather than evicting the log around it.
 *
 * Nothing real approaches this. The largest events are a rejected planner
 * document and a system prompt, both tens of kilobytes.
 */
export const MAX_EVENT_BYTES = MAX_BYTES / 8;
/** How much of an oversized payload's key list survives in its replacement. */
export const MAX_OVERSIZED_KEYS = 32;
export const MAX_OVERSIZED_KEY_CHARS = 64;

type Listener = () => void;

let events: readonly DebugEvent[] = [];
let seq = 0;
let bytes = 0;
let paused = false;
let mirror = false;
const listeners = new Set<Listener>();

/**
 * Record one event.
 *
 * Total by construction: redaction cannot throw, and a listener that does is
 * caught. Instrumentation that can break the thing it observes is worse than
 * no instrumentation, because it only fails once you are already debugging.
 */
export function emit(record: DebugRecord): void {
  if (paused) return;

  // Bounded before it is weighed, and it is weighed with the payload. A
  // summary is composed by the caller and never passes through `redact`, so
  // without this the per-event cap bounds the detail and nothing else -- and
  // one event could then exceed MAX_BYTES and drain the whole buffer in
  // `evict`, which is exactly what the cap exists to make unreachable.
  const summary = capSummary(record.summary);

  let detail = record.detail === undefined ? undefined : redact(record.detail);
  let bytesFor = weigh(detail, summary);
  if (bytesFor > MAX_EVENT_BYTES) {
    // The replacement has to satisfy the cap it is standing in for, and its
    // one unbounded part is the key list: a payload with enough long keys
    // produced a replacement that was itself over the cap, which made the
    // "always satisfiable" claim below false. So the list is bounded in count
    // and in key length, and if the replacement is still over -- which the
    // bounds make unreachable, but the check is cheaper than the argument --
    // the keys are dropped and the note stands alone.
    const keys =
      detail != null && typeof detail === 'object'
        ? Object.keys(detail).slice(0, MAX_OVERSIZED_KEYS).map((k) => k.slice(0, MAX_OVERSIZED_KEY_CHARS))
        : [];
    const dropped = bytesFor;
    const note = `This payload was ${dropped} bytes, over the ${MAX_EVENT_BYTES}-byte per-event cap, and was dropped.`;
    detail = { oversized: true, bytes: dropped, keys, note };
    bytesFor = weigh(detail, summary);
    if (bytesFor > MAX_EVENT_BYTES) {
      detail = { oversized: true, bytes: dropped, keys: [], note };
      bytesFor = weigh(detail, summary);
    }
  }

  const event: DebugEvent = {
    seq: (seq += 1),
    at: Date.now(),
    channel: record.channel,
    event: record.event,
    summary,
    level: record.level,
    ...(record.durationMs != null ? { durationMs: record.durationMs } : {}),
    ...(detail === undefined ? {} : { detail }),
    bytes: bytesFor,
  };

  events = [...events, event];
  bytes += event.bytes;
  evict();

  if (mirror) {
    const line = `[h3 ${event.channel}] ${event.event} -- ${event.summary}`;
    if (event.level === 'error') console.error(line, event.detail);
    else if (event.level === 'warn') console.warn(line, event.detail);
    else console.debug(line, event.detail);
  }

  notify();
}

/**
 * Oldest first, by both limits, because either one alone lets the other run away.
 *
 * No special case for an event that cannot fit: `MAX_EVENT_BYTES` makes that
 * unreachable, so this terminates with at worst one event held.
 */
function evict(): void {
  while (events.length > MAX_EVENTS || bytes > MAX_BYTES) {
    bytes -= events[0].bytes;
    events = events.slice(1);
  }
}

/** The convenience wrapper every call site actually uses. */
export function trace(
  channel: DebugChannel,
  event: string,
  summary: string,
  detail?: unknown,
  options: { level?: DebugLevel; durationMs?: number } = {},
): void {
  emit({
    channel,
    event,
    summary,
    level: options.level ?? 'info',
    ...(options.durationMs != null ? { durationMs: options.durationMs } : {}),
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * A stable array whose identity changes only when something was recorded.
 *
 * Shaped for `useSyncExternalStore`, which compares by identity and will loop
 * forever against a getter that rebuilds. That is why `emit` replaces the array
 * rather than pushing to it.
 */
export function snapshot(): readonly DebugEvent[] {
  return events;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A panel that throws while rendering must not stop the app from working.
    }
  }
}

export function clearLog(): void {
  events = [];
  bytes = 0;
  notify();
}

/** Freeze recording, so a log can be read while the app keeps being used. */
export function setPaused(next: boolean): void {
  paused = next;
  notify();
}

export function isPaused(): boolean {
  return paused;
}

/** Also write every event to the browser console, for people who prefer it there. */
export function setMirrorToConsole(next: boolean): void {
  mirror = next;
  notify();
}

export function isMirroring(): boolean {
  return mirror;
}

/** Bytes currently retained, which is what the panel reports beside the count. */
export function retainedBytes(): number {
  return bytes;
}

/** Full reset. For tests, and for nothing else -- the panel's clear keeps settings. */
export function resetBus(): void {
  events = [];
  seq = 0;
  bytes = 0;
  paused = false;
  mirror = false;
  listeners.clear();
}
