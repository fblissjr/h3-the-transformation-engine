/**
 * Which backend the next call goes to.
 *
 * The two are not interchangeable and the panel does not pretend they are.
 * Gemini needs a key and sends the prompt to Google; heylook needs a server
 * running on this network and sends it nowhere else. Switching is explicit for
 * that reason -- there is no fallback from one to the other, because falling
 * back to a paid hosted API when a local server is down would be a surprise
 * with a bill attached.
 *
 * The model list is whatever the server is serving right now. heylook's
 * registry is override-only, so the roster changes when a model is downloaded
 * with no config edit and no restart; a list hard-coded here would be wrong on
 * the first Tuesday somebody tried something new.
 */

import {
  DEFAULT_MODEL,
  GEMINI_PRESET_MODELS,
  type GeminiConfig,
  type ThinkingLevel,
  type VideoProcessingMode,
  type VideoResolution,
} from '../provider/gemini';
import type { HeylookModel } from '../provider/heylook';
import type { Instance } from '../provider/registry';
import type { ProviderId } from '../provider/types';

interface Props {
  provider: ProviderId;
  geminiConfig?: GeminiConfig;
  onGeminiConfigChange?: (patch: Partial<GeminiConfig>) => void;
  enforceSchema: boolean;
  onEnforceSchemaChange: (next: boolean) => void;
  /** False when the active backend has no way to constrain decoding. */
  canEnforceSchema: boolean;
  instances: Instance[];
  instanceId: string;
  onInstanceChange: (id: string) => void;
  onProviderChange: (provider: ProviderId) => void;
  origin: string;
  models: HeylookModel[] | null;
  modelId: string | null;
  onModelChange: (id: string) => void;
  discovering: boolean;
  /** Non-null while a model is being made resident, naming which. */
  loadingModel: string | null;
  error: string | null;
  onRefresh: () => void;
}

/** Named for where the prompt goes, which is the difference that matters. */
const PROVIDER_LABEL: Record<ProviderId, string> = {
  gemini: 'Gemini',
  heylook: 'heylook (local)',
};

export function ProviderPanel({
  provider,
  geminiConfig,
  onGeminiConfigChange,
  enforceSchema,
  onEnforceSchemaChange,
  canEnforceSchema,
  instances,
  instanceId,
  onInstanceChange,
  onProviderChange,
  origin,
  models,
  modelId,
  onModelChange,
  discovering,
  loadingModel,
  error,
  onRefresh,
}: Props) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
      <select
        value={provider}
        onChange={(event) => onProviderChange(event.target.value as ProviderId)}
        className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
        title={
          provider === 'heylook'
            ? `Prompts go to ${origin} and nowhere else.`
            : 'Prompts go to Google. What is kept is governed by the terms attached to your key.'
        }
      >
        {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((id) => (
          <option key={id} value={id}>
            {PROVIDER_LABEL[id]}
          </option>
        ))}
      </select>

      {provider === 'heylook' && (
        <>
          {/*
            Shown only when there is a choice. Origins are fixed at build time
            because the page's connect-src is generated from them, so this
            picks among configured machines rather than naming a new one --
            and with one configured there is nothing to pick.
          */}
          {instances.length > 1 && (
            <select
              value={instanceId}
              onChange={(event) => onInstanceChange(event.target.value)}
              className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
              title="Which configured machine to talk to. Each has its own model roster."
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.id}
                </option>
              ))}
            </select>
          )}

          {discovering && <span>asking {origin}…</span>}

          {/*
            A cold load writes nothing to the connection while it runs, so
            without this the app looks hung for as long as the model takes to
            read. Naming the model rather than saying "loading" is the point:
            the wait belongs to the thing just selected.
          */}
          {loadingModel != null && <span>loading {loadingModel}…</span>}

          {!discovering && models != null && models.length > 0 && (
            <select
              value={modelId ?? ''}
              onChange={(event) => onModelChange(event.target.value)}
              className="max-w-[220px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
            >
              {modelId == null && <option value="">choose a model</option>}
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                  {/*
                    Vision is called out because it is the capability the app
                    actually branches on: reference images are dropped or
                    refused without it, and the roster gives no other hint.
                  */}
                  {model.capabilities?.includes('vision') ? ' (vision)' : ''}
                </option>
              ))}
            </select>
          )}

          {!discovering && error && (
            <span className="max-w-[320px] truncate text-[var(--color-danger)]" title={error}>
              {error}
            </span>
          )}

          <button type="button" onClick={onRefresh} className="underline" disabled={discovering}>
            refresh
          </button>
        </>
      )}

      {provider === 'gemini' && (
        <>
          <select
            value={
              GEMINI_PRESET_MODELS.includes((geminiConfig?.model ?? DEFAULT_MODEL) as never)
                ? (geminiConfig?.model ?? DEFAULT_MODEL)
                : 'custom'
            }
            onChange={(event) => {
              if (event.target.value !== 'custom') {
                onGeminiConfigChange?.({ model: event.target.value });
              } else {
                onGeminiConfigChange?.({ model: '' });
              }
            }}
            className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
            title="Which Gemini model to use."
          >
            {GEMINI_PRESET_MODELS.map((m) => (
              <option key={m} value={m}>
                {m.replace('models/', '')}
                {m === DEFAULT_MODEL ? ' (default)' : ''}
              </option>
            ))}
            <option value="custom">custom…</option>
          </select>

          {(!GEMINI_PRESET_MODELS.includes((geminiConfig?.model ?? DEFAULT_MODEL) as never) ||
            geminiConfig?.model === '') && (
            <input
              type="text"
              placeholder="model id"
              value={geminiConfig?.model ?? ''}
              onChange={(event) => onGeminiConfigChange?.({ model: event.target.value })}
              className="w-[140px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5"
              title="Enter custom Gemini model identifier"
            />
          )}

          <details className="relative">
            <summary className="cursor-pointer select-none underline">gemini parameters</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-[380px] flex-col gap-2 rounded border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 shadow-xl">
              <div className="text-xs font-semibold text-[var(--color-fg)]">
                Gemini Interactions API Configuration
              </div>

              {/* Planner Thinking Level */}
              <div className="flex items-center justify-between">
                <span>Planner thinking:</span>
                <select
                  value={geminiConfig?.plannerThinkingLevel ?? 'medium'}
                  onChange={(e) =>
                    onGeminiConfigChange?.({ plannerThinkingLevel: e.target.value as ThinkingLevel })
                  }
                  className="rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5"
                >
                  <option value="low">low</option>
                  <option value="medium">medium (default)</option>
                  <option value="high">high</option>
                </select>
              </div>

              {/* Patch Thinking Level */}
              <div className="flex items-center justify-between">
                <span>Patch thinking:</span>
                <select
                  value={geminiConfig?.patchThinkingLevel ?? 'low'}
                  onChange={(e) =>
                    onGeminiConfigChange?.({ patchThinkingLevel: e.target.value as ThinkingLevel })
                  }
                  className="rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5"
                >
                  <option value="low">low (default)</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>

              {/* Video Processing Mode (Agentic Video Understanding) */}
              <div className="flex items-center justify-between">
                <span title="Agentic mode dynamically navigates video timeline, loading only needed segments (up to 88% fewer tokens).">
                  Video processing:
                </span>
                <select
                  value={geminiConfig?.videoProcessing ?? 'agentic'}
                  onChange={(e) =>
                    onGeminiConfigChange?.({ videoProcessing: e.target.value as VideoProcessingMode })
                  }
                  className="rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5"
                >
                  <option value="agentic">agentic (dynamic timeline, recommended)</option>
                  <option value="static">static (fixed 1 FPS)</option>
                </select>
              </div>

              {/* Video Resolution */}
              <div className="flex items-center justify-between">
                <span>Video resolution:</span>
                <select
                  value={geminiConfig?.videoResolution ?? ''}
                  onChange={(e) =>
                    onGeminiConfigChange?.({
                      videoResolution: (e.target.value || undefined) as VideoResolution | undefined,
                    })
                  }
                  className="rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5"
                >
                  <option value="">default</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="ultra_high">ultra high</option>
                </select>
              </div>

              {/* Thinking Summaries */}
              <div className="flex items-center justify-between">
                <span>Thinking summaries:</span>
                <select
                  value={geminiConfig?.thinkingSummaries ?? ''}
                  onChange={(e) =>
                    onGeminiConfigChange?.({
                      thinkingSummaries: (e.target.value || undefined) as 'auto' | 'none' | undefined,
                    })
                  }
                  className="rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5"
                >
                  <option value="">default (none)</option>
                  <option value="auto">auto</option>
                  <option value="none">none</option>
                </select>
              </div>

              {/* Max Output Tokens */}
              <div className="flex items-center justify-between">
                <span>Max output tokens:</span>
                <input
                  type="number"
                  min={256}
                  max={65536}
                  placeholder="default"
                  value={geminiConfig?.maxOutputTokens ?? ''}
                  onChange={(e) =>
                    onGeminiConfigChange?.({
                      maxOutputTokens: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                  className="w-[90px] rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5 text-right"
                />
              </div>

              <div className="mt-1 flex items-center justify-between border-t border-[var(--color-edge)] pt-2 text-[9px] text-[var(--color-muted)]">
                <span>store: false (hardcoded privacy)</span>
                <button
                  type="button"
                  onClick={() =>
                    onGeminiConfigChange?.({
                      model: undefined,
                      plannerThinkingLevel: undefined,
                      patchThinkingLevel: undefined,
                      videoProcessing: undefined,
                      videoResolution: undefined,
                      thinkingSummaries: undefined,
                      maxOutputTokens: undefined,
                      stopSequences: undefined,
                    })
                  }
                  className="underline hover:text-[var(--color-fg)]"
                >
                  reset defaults
                </button>
              </div>
            </div>
          </details>
        </>
      )}

      {/*
        Shown for every provider, never only for the one that supports it. The
        setting describes how you want the document produced, not who produces
        it, so hiding it on a local backend would teach that it is a Gemini
        feature -- and it is the same flag for a third backend that can.

        Not heylook, though: that project has said it will not add constrained
        decoding, so `canEnforceSchema: false` there is a settled answer rather
        than a gap waiting to close. Recorded as a decision reported to us, not
        as something measured -- but it does mean the shape trailer and the
        defensive parse in `src/provider/shape.ts` are heylook's permanent path
        rather than an interim one.

        A backend that cannot honour it says so here instead of the control
        vanishing, because a disappearing checkbox reads as a bug and a silently
        ignored one is worse.
      */}
      <label
        className={`flex items-center gap-1 ${canEnforceSchema ? '' : 'opacity-40'}`}
        title={
          canEnforceSchema
            ? 'Constrain decoding to the schema. Off asks for the shape in the prompt instead, ' +
              'which leaves the prose unconstrained -- the trade this project cares about.'
            : `${provider} cannot constrain decoding, so the shape is always requested in the ` +
              'prompt. The setting is kept because it travels with you to a backend that can.'
        }
      >
        <input
          type="checkbox"
          checked={enforceSchema}
          disabled={!canEnforceSchema}
          onChange={(event) => onEnforceSchemaChange(event.target.checked)}
        />
        enforce schema
        {!canEnforceSchema && <span className="ml-0.5">(n/a)</span>}
      </label>
    </div>
  );
}
