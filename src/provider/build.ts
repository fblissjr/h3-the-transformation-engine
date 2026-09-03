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
        ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
      }),
    );
  }
  return params.apiKey
    ? instrument(new GeminiClient({ apiKey: params.apiKey, config: params.geminiConfig }))
    : null;
}
