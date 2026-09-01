/**
 * The debug console's public surface.
 *
 * Everything outside this directory imports from here. `src/core/` imports
 * none of it and must not start: the compiler stays runnable in a Node script,
 * and a tracing sink -- a module-level buffer -- is exactly the kind of
 * convenience that erodes that boundary. `test/purity.test.ts` bans the import
 * outright, barrel and deep path alike, because a boundary nothing checks
 * erodes on the first convenient import. The pipeline, the clients, the storage
 * layer and the UI are all outside core, and that is where every emit lives.
 */

export {
  clearLog,
  emit,
  isMirroring,
  isPaused,
  MAX_BYTES,
  MAX_EVENT_BYTES,
  MAX_OVERSIZED_KEY_CHARS,
  MAX_OVERSIZED_KEYS,
  MAX_EVENTS,
  resetBus,
  retainedBytes,
  setMirrorToConsole,
  setPaused,
  snapshot,
  subscribe,
  trace,
} from './bus';
export { exposeDebugHandle, type DebugHandle } from './expose';
export { instrument } from './instrument';
export { capSummary, MAX_STRING, MAX_SUMMARY, redact, weigh } from './redact';
export { DEBUG_CHANNELS } from './types';
export type { DebugChannel, DebugEvent, DebugLevel, DebugRecord } from './types';
