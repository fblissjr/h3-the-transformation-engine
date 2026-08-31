/**
 * The debug console.
 *
 * One flat, filterable list rather than a tab per layer. The question it exists
 * to answer is "I pressed generate, what happened" -- and the answer crosses
 * every layer in time order: a state event, a compile stage, a wire body, a
 * queue wait, a reply, a parse, a version written. Splitting those into tabs
 * would hide exactly the sequence that carries the answer.
 *
 * It reads a buffer that was recording before it was opened, so the usual
 * order -- do the thing, then wonder what it did -- works. See `src/debug/bus.ts`
 * for why that buffer is bounded and why it is never written to storage.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearLog,
  DEBUG_CHANNELS,
  isMirroring,
  isPaused,
  MAX_BYTES,
  retainedBytes,
  setMirrorToConsole,
  setPaused,
  snapshot,
  subscribe,
  type DebugChannel,
  type DebugEvent,
} from '../../debug';

const CHANNEL_COLOR: Record<DebugChannel, string> = {
  provider: 'var(--color-accent)',
  pipeline: '#9d7cf0',
  state: '#5fd0a0',
  storage: 'var(--color-warn)',
};

/**
 * The lowercased text the filter searches, computed once per event.
 *
 * The filter used to `JSON.stringify` every payload on every pass -- and the
 * memo depends on `events`, so that was the whole buffer re-serialized on each
 * keystroke AND on each new event, up to 4 MB a time with roughly fifteen
 * events fired by one generation. A rolling stall that grows as the log fills,
 * which a browser pass over five tiny events cannot see.
 *
 * A WeakMap rather than a field on the event, so the haystack does not double
 * the retained bytes the buffer is budgeting; it is collected with the event it
 * keys, and it survives the array-identity change every emit produces.
 */
const haystacks = new WeakMap<DebugEvent, string>();

function haystackFor(event: DebugEvent): string {
  const cached = haystacks.get(event);
  if (cached !== undefined) return cached;
  let text = `${event.event} ${event.summary}`;
  if (event.detail !== undefined) {
    try {
      text += ` ${JSON.stringify(event.detail)}`;
    } catch {
      // Redaction should have made this impossible; searching the rest is
      // better than failing to render the panel.
    }
  }
  const lowered = text.toLowerCase();
  haystacks.set(event, lowered);
  return lowered;
}

function levelColor(level: DebugEvent['level']): string | undefined {
  if (level === 'error') return 'var(--color-danger)';
  if (level === 'warn') return 'var(--color-warn)';
  return undefined;
}

function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * The subscription the panel reads through.
 *
 * `useSyncExternalStore` compares snapshots by identity, so the bus replaces
 * its array rather than pushing to it. A getter that rebuilt on every call
 * would re-render forever.
 */
function useDebugEvents(): readonly DebugEvent[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function DebugConsole() {
  const [open, setOpen] = useState(false);
  const events = useDebugEvents();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="What the app is doing: requests, replies, compiler stages, state and storage"
        className={`rounded border px-2 py-1 text-[10px] ${
          open
            ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
            : 'border-[var(--color-edge)] text-[var(--color-muted)] hover:bg-white/5'
        }`}
      >
        debug{events.length > 0 ? ` (${events.length})` : ''}
      </button>
      {open && <Drawer events={events} onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ events, onClose }: { events: readonly DebugEvent[]; onClose: () => void }) {
  const [channels, setChannels] = useState<Set<DebugChannel>>(new Set(DEBUG_CHANNELS));
  const [needle, setNeedle] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Mirrored into React state so the buttons re-render; the bus is the truth.
  const [paused, setPausedLocal] = useState(isPaused());
  const [mirror, setMirrorLocal] = useState(isMirroring());

  const shown = useMemo(() => {
    const term = needle.trim().toLowerCase();
    return events.filter((event) => {
      if (!channels.has(event.channel)) return false;
      if (problemsOnly && event.level === 'info') return false;
      if (term === '') return true;
      // The payload is searched too, so "seed" or an interaction id finds the
      // event that carries it and not only the ones that name it in a summary.
      return haystackFor(event).includes(term);
    });
  }, [events, channels, needle, problemsOnly]);

  const toggleChannel = (channel: DebugChannel) => {
    setChannels((current) => {
      const next = new Set(current);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });
  };

  /**
   * Follow the tail, unless the reader has scrolled away from it.
   *
   * Newest-last with no auto-scroll means pressing generate shows nothing
   * without scrolling, which is the panel's primary use. Sticking only when
   * already at the bottom is what keeps it from yanking the view away from
   * someone reading an older row.
   */
  const listRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  // Keyed on the newest event's seq, NOT on `shown.length`. Once the buffer is
  // at either bound every new event evicts an old one, so the length stops
  // changing and a length-keyed effect stops firing -- the panel would silently
  // stop following the tail exactly when the log is busiest, which is the one
  // moment it is being watched.
  const newest = shown.length === 0 ? 0 : shown[shown.length - 1].seq;
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [newest]);

  const copy = () => {
    void navigator.clipboard.writeText(JSON.stringify(shown, null, 2));
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex h-[45vh] flex-col border-t border-[var(--color-edge)] bg-[var(--color-panel)] shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-edge)] px-3 py-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wide">Debug console</span>

        {DEBUG_CHANNELS.map((channel) => (
          <button
            key={channel}
            type="button"
            onClick={() => toggleChannel(channel)}
            className="rounded border px-1.5 py-0.5"
            style={{
              borderColor: channels.has(channel) ? CHANNEL_COLOR[channel] : 'var(--color-edge)',
              color: channels.has(channel) ? CHANNEL_COLOR[channel] : 'var(--color-muted)',
            }}
          >
            {channel}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setProblemsOnly((v) => !v)}
          className={`rounded border px-1.5 py-0.5 ${
            problemsOnly
              ? 'border-[var(--color-danger)] text-[var(--color-danger)]'
              : 'border-[var(--color-edge)] text-[var(--color-muted)]'
          }`}
          title="Hide anything that went normally"
        >
          problems only
        </button>

        <input
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          placeholder="filter (searches payloads too)"
          className="w-52 rounded border border-[var(--color-edge)] bg-black/30 px-1.5 py-0.5"
        />

        <div className="flex-1" />

        <span className="text-[var(--color-muted)]">
          {shown.length}/{events.length} events &middot; {kb(retainedBytes())} of {kb(MAX_BYTES)}
        </span>

        <button
          type="button"
          onClick={() => {
            const next = !paused;
            setPaused(next);
            setPausedLocal(next);
          }}
          className={`rounded border px-1.5 py-0.5 ${
            paused
              ? 'border-[var(--color-warn)] text-[var(--color-warn)]'
              : 'border-[var(--color-edge)] text-[var(--color-muted)]'
          }`}
          title="Stop recording, so the list holds still while you read it"
        >
          {paused ? 'paused' : 'recording'}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !mirror;
            setMirrorToConsole(next);
            setMirrorLocal(next);
          }}
          className={`rounded border px-1.5 py-0.5 ${
            mirror
              ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
              : 'border-[var(--color-edge)] text-[var(--color-muted)]'
          }`}
          title="Also write every event to the browser console"
        >
          mirror
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 hover:bg-white/5"
          title="Copy the filtered events as JSON"
        >
          copy
        </button>
        <button
          type="button"
          onClick={() => {
            clearLog();
            setExpanded(new Set());
          }}
          className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 hover:bg-white/5"
        >
          clear
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 hover:bg-white/5"
        >
          close
        </button>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]"
      >
        {shown.length === 0 ? (
          <p className="p-4 text-[var(--color-muted)]">
            {events.length === 0
              ? 'Nothing recorded yet. Generate something, or switch provider, and every layer reports here.'
              : 'Nothing matches the current filter.'}
          </p>
        ) : (
          shown.map((event) => (
            <Row
              key={event.seq}
              event={event}
              open={expanded.has(event.seq)}
              onToggle={() =>
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(event.seq)) next.delete(event.seq);
                  else next.add(event.seq);
                  return next;
                })
              }
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({ event, open, onToggle }: { event: DebugEvent; open: boolean; onToggle: () => void }) {
  const hasDetail = event.detail !== undefined;
  return (
    <div className="border-b border-[var(--color-edge)]/50">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDetail}
        className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-white/5 disabled:cursor-default"
      >
        <span className="w-3 shrink-0 text-[var(--color-muted)]">
          {hasDetail ? (open ? '-' : '+') : ' '}
        </span>
        <span className="shrink-0 text-[var(--color-muted)]">{clock(event.at)}</span>
        <span className="w-16 shrink-0" style={{ color: CHANNEL_COLOR[event.channel] }}>
          {event.channel}
        </span>
        <span className="shrink-0 text-[var(--color-muted)]">{event.event}</span>
        <span className="min-w-0 flex-1 truncate" style={{ color: levelColor(event.level) }}>
          {event.summary}
        </span>
        {event.durationMs != null && (
          <span className="shrink-0 text-[var(--color-muted)]">{event.durationMs} ms</span>
        )}
      </button>
      {open && hasDetail && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-black/30 px-3 py-2 text-[10.5px] text-[#c7d0dd]">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
