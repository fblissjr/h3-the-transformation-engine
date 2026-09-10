/**
 * Runtime discovery and normalization of heylook presets.
 *
 * A heylook preset is a server-side configuration bundle containing:
 *  - Sampler settings (temperature, top_p, max_tokens, thinking)
 *  - System prompt (creative direction, styling or tone)
 *
 * Presets are imported via a snapshot gesture into the app rather than bound
 * dynamically across calls, maintaining prompt reproducibility and document purity.
 */

import { HEYLOOK_INSTANCES } from '../registry';
import { trace } from '../../debug';
import { DiscoveryError } from './models';
import type { ThinkingPreference } from './client';

export interface HeylookPreset {
  id: string;
  name: string;
  updatedAt?: string | number;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinking?: ThinkingPreference;
  raw?: Record<string, unknown>;
}

/**
 * Tolerantly normalizes a raw preset object from the server.
 * Accepts flat attributes or nested `params` bags.
 */
export function normalizePreset(row: unknown): HeylookPreset | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  const id = String(r.id ?? r.name ?? '').trim();
  if (!id) return null;

  const name = String(r.name ?? r.label ?? id).trim();
  const updatedAt =
    typeof r.updated_at === 'string' || typeof r.updated_at === 'number'
      ? r.updated_at
      : typeof r.updatedAt === 'string' || typeof r.updatedAt === 'number'
        ? r.updatedAt
        : undefined;

  const promptRaw =
    r.system_prompt ??
    r.systemPrompt ??
    r.prompt ??
    (r.params as Record<string, unknown> | undefined)?.system_prompt;
  const systemPrompt = typeof promptRaw === 'string' ? promptRaw : undefined;

  const params = (r.params != null && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>;

  const tempRaw = r.temperature ?? params.temperature;
  const temperature = typeof tempRaw === 'number' ? tempRaw : undefined;

  const topPRaw = r.top_p ?? r.topP ?? params.top_p ?? params.topP;
  const topP = typeof topPRaw === 'number' ? topPRaw : undefined;

  const maxTokensRaw =
    r.max_tokens ??
    r.max_output_tokens ??
    r.maxOutputTokens ??
    params.max_tokens ??
    params.max_output_tokens ??
    params.maxOutputTokens;
  const maxOutputTokens = typeof maxTokensRaw === 'number' ? maxTokensRaw : undefined;

  // Thinking resolution: can be an object { mode, effort }, boolean, or enable_thinking flag
  let thinking: ThinkingPreference | undefined;
  const thinkingRaw = r.thinking ?? params.thinking;
  if (typeof thinkingRaw === 'object' && thinkingRaw !== null) {
    const t = thinkingRaw as Record<string, unknown>;
    const mode = t.mode === 'on' || t.mode === 'off' || t.mode === 'auto' ? t.mode : undefined;
    if (mode) {
      thinking = {
        mode,
        ...(typeof t.effort === 'string' ? { effort: t.effort } : {}),
      };
    }
  } else if (typeof thinkingRaw === 'boolean') {
    thinking = { mode: thinkingRaw ? 'on' : 'off' };
  } else if (typeof r.enable_thinking === 'boolean' || typeof params.enable_thinking === 'boolean') {
    const enabled = Boolean(r.enable_thinking ?? params.enable_thinking);
    const effort =
      typeof r.reasoning_effort === 'string'
        ? r.reasoning_effort
        : typeof params.reasoning_effort === 'string'
          ? params.reasoning_effort
          : undefined;
    thinking = {
      mode: enabled ? 'on' : 'off',
      ...(effort ? { effort } : {}),
    };
  }

  return {
    id,
    name,
    ...(updatedAt != null ? { updatedAt } : {}),
    ...(systemPrompt != null ? { systemPrompt } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { topP } : {}),
    ...(maxOutputTokens != null ? { maxOutputTokens } : {}),
    ...(thinking != null ? { thinking } : {}),
    raw: r,
  };
}

/**
 * Fetch available presets from the heylook server.
 */
export async function listPresets(
  origin: string = HEYLOOK_INSTANCES[0].origin,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<HeylookPreset[]> {
  const { signal, fetchImpl = fetch } = options;
  const started = Date.now();
  trace('provider', 'provider.presets.request', `heylook GET ${origin}/v1/presets`, { origin });

  let response: Response;
  try {
    response = await fetchImpl(`${origin}/v1/presets`, signal ? { signal } : {});
  } catch (cause) {
    if (cause instanceof DOMException && (cause.name === 'AbortError' || cause.name === 'TimeoutError')) {
      throw cause;
    }
    throw new DiscoveryError(
      `Could not reach heylook presets at ${origin}. Server may be offline or unreachable.`,
      cause,
    );
  }

  if (!response.ok) {
    throw new DiscoveryError(`heylook answered ${response.status} for /v1/presets at ${origin}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new DiscoveryError(`Reply from ${origin}/v1/presets was not JSON.`, cause);
  }

  const rows = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown })?.data)
      ? (body as { data: unknown[] }).data
      : null;

  if (!rows) {
    throw new DiscoveryError(
      `Reply from ${origin}/v1/presets is not heylook's shape -- neither an array nor { data: [...] }.`,
    );
  }

  const presets = rows
    .map(normalizePreset)
    .filter((p): p is HeylookPreset => p !== null);

  trace(
    'provider',
    'provider.presets.response',
    `heylook reported ${presets.length} preset(s)`,
    { origin, count: presets.length },
    { durationMs: Date.now() - started, level: 'info' },
  );

  return presets;
}

// ---------------------------------------------------------------------------
// Preset Roster Lifecycle State Machine
// ---------------------------------------------------------------------------

export type PresetRosterState =
  | { kind: 'unasked' }
  | { kind: 'asking'; instanceId: string }
  | { kind: 'ready'; instanceId: string; presets: HeylookPreset[] }
  | { kind: 'failed'; instanceId: string; error: string };

export type PresetRosterEvent =
  | { type: 'ask'; instanceId: string }
  | { type: 'resolved'; instanceId: string; presets: HeylookPreset[] }
  | { type: 'failed'; instanceId: string; error: string }
  | { type: 'reset' }
  | { type: 'reconsider' };

export const INITIAL_PRESET_ROSTER: PresetRosterState = { kind: 'unasked' };

export function shouldDiscoverPresets(state: PresetRosterState): boolean {
  return state.kind === 'unasked';
}

export function reducePresetRoster(
  state: PresetRosterState,
  event: PresetRosterEvent,
): PresetRosterState {
  switch (event.type) {
    case 'ask':
      return { kind: 'asking', instanceId: event.instanceId };

    case 'resolved':
      if (state.kind !== 'asking' || state.instanceId !== event.instanceId) return state;
      return { kind: 'ready', instanceId: event.instanceId, presets: event.presets };

    case 'failed':
      if (state.kind !== 'asking' || state.instanceId !== event.instanceId) return state;
      return { kind: 'failed', instanceId: event.instanceId, error: event.error };

    case 'reset':
      return state.kind === 'unasked' ? state : INITIAL_PRESET_ROSTER;

    case 'reconsider':
      return state.kind === 'failed' ? INITIAL_PRESET_ROSTER : state;
  }
}

export function presetRosterPresets(state: PresetRosterState): HeylookPreset[] | null {
  return state.kind === 'ready' ? state.presets : null;
}
