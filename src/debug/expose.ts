/**
 * The same log, reachable from the browser console.
 *
 * `window.__h3debug.events()` beats a screenshot of the panel when the thing
 * you want is a payload to grep or paste. It also gives a browser-automation
 * pass something to assert against, which is the gap that has produced four
 * bugs in this repo -- each passed the suite and broke the running app, and
 * each would have been visible in this log.
 *
 * Not a security hole in any new way: script on this origin can already read
 * the unlocked key straight out of memory. See the ceiling stated in the
 * README's Security section.
 */

import { clearLog, isPaused, retainedBytes, setMirrorToConsole, setPaused, snapshot } from './bus';
import type { DebugChannel, DebugEvent } from './types';

export interface DebugHandle {
  events: (channel?: DebugChannel) => readonly DebugEvent[];
  last: (n?: number) => readonly DebugEvent[];
  clear: () => void;
  pause: (next?: boolean) => boolean;
  mirror: (next?: boolean) => void;
  bytes: () => number;
}

export function exposeDebugHandle(target: Record<string, unknown>): void {
  const handle: DebugHandle = {
    events: (channel) =>
      channel == null ? snapshot() : snapshot().filter((e) => e.channel === channel),
    last: (n = 20) => snapshot().slice(-n),
    clear: clearLog,
    pause: (next) => {
      if (next != null) setPaused(next);
      return isPaused();
    },
    mirror: (next = true) => setMirrorToConsole(next),
    bytes: retainedBytes,
  };
  target.__h3debug = handle;
}
