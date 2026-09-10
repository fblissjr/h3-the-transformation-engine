/**
 * The one place a client is constructed.
 *
 * Extracted from the memo in `useEngine` for the reason `heylookPolicyConfig`
 * gives one file over: a mapping buried in a React memo is a mapping nothing
 * can reach. Specifically, `instrument()` was applied there and nowhere a test
 * could see it -- so deleting the wrap would have left every one of the debug
 * console's tests green and the provider channel silent in the running app,
 * which is the exact shape of the four bugs CLAUDE.md records.
 *
 * Returns null rather than throwing when the backend is not ready, because
 * "not ready" is the app's most common state and each provider is unready for
 * its own reason. The reason itself belongs to the UI, which words it.
 */

import { GeminiClient, type GeminiConfig } from './gemini';
import { HeylookClient } from './heylook';
import type { HeylookModel } from './heylook';
import { instrument } from '../debug';
import type { ThinkingPreference } from './heylook/client';
import type { InferenceClient, ProviderId } from './types';

export interface ClientParams {
  provider: ProviderId;
  /** Gemini: present once a stored key has been unlocked. */
  apiKey?: string | null;
  /** Gemini: optional configuration for model, thinking levels, video processing, etc. */
  geminiConfig?: GeminiConfig;
  /** heylook: the origin from `instanceFor`, which is the only legal source. */
  origin?: string;
  /** heylook: the capability row, carried whole so vision gating reads it. */
  model?: HeylookModel | null;
  /** heylook: from the resolved policy, via `heylookPolicyConfig`. */
  backpressureBudgetMs?: number;
  /**
   * heylook: a bearer token for this instance, when the server asks for one.
   *
   * Prefixed where the sibling above is not, because `apiKey` on this bag is
   * already Gemini's and one flat bag cannot hold two fields of that name. Said
   * out loud rather than left to look arbitrary: the asymmetry is the name being
   * taken, not a difference in kind. Per-role bindings will restructure this bag
   * and are the right moment to fix it.
   */
  heylookApiKey?: string | null;
  /**
   * heylook: whether to ask a thinking model to think, and how hard.
   *
   * This field is why `runs.thinking` was NULL for every call before it existed.
   * `heylookPolicyConfig` carries `backpressureBudgetMs` alone, this bag had no
   * thinking field, and `buildClient` passed none — so the client always got
   * `THINKING_DEFAULT` and the app could express no value but off. The pending
   * decision on the thinking default was unimplementable in either direction
   * until this existed, which is a stronger reason to have it than the setting.
   */
  thinking?: ThinkingPreference;
  /** heylook: sampling temperature (overrides model default if specified) */
  temperature?: number;
  /** heylook: nucleus sampling top_p (overrides model default if specified) */
  topP?: number;
  /** heylook: output token ceiling */
  maxOutputTokens?: number;
  /**
   * heylook: the transport.
   *
   * Threaded through solely so this factory can be driven without a server --
   * the same reason `HeylookClientConfig` carries it. The app never passes one.
   */
  fetchImpl?: typeof fetch;
}

/** The client the pipeline gets, traced, or null when this backend is not ready. */
export function buildClient(params: ClientParams): InferenceClient | null {
  if (params.provider === 'heylook') {
    if (!params.model) return null;
    return instrument(
      new HeylookClient({
        ...(params.origin != null ? { origin: params.origin } : {}),
        model: params.model,
        ...(params.backpressureBudgetMs != null
          ? { backpressureBudgetMs: params.backpressureBudgetMs }
          : {}),
        // Absent rather than null: the client treats an empty key as no key, and
        // sending the field at all would make "no token" and "a token that is
        // the empty string" two states at this layer for no gain.
        ...(params.heylookApiKey ? { apiKey: params.heylookApiKey } : {}),
        ...(params.thinking ? { thinking: params.thinking } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.topP != null ? { topP: params.topP } : {}),
        ...(params.maxOutputTokens != null ? { maxOutputTokens: params.maxOutputTokens } : {}),
        ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
      }),
    );
  }
  return params.apiKey
    ? instrument(new GeminiClient({ apiKey: params.apiKey, config: params.geminiConfig }))
    : null;
}
