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
import { useState } from 'react';
import type { HeylookModel, HeylookPreset } from '../provider/heylook';
import type { ThinkingPreference } from '../provider/heylook/client';
import type { Instance } from '../provider/registry';
import type { ProviderId } from '../provider/types';
import type { PresetProvenance } from '../core/ir/types';

interface Props {
  provider: ProviderId;
  geminiConfig?: GeminiConfig;
  onGeminiConfigChange?: (patch: Partial<GeminiConfig>) => void;
  thinking: ThinkingPreference;
  onThinkingChange: (next: ThinkingPreference) => void;
  heylookToken: string | null;
  onHeylookTokenChange: (next: string) => void;
  instances: Instance[];
  instanceId: string;
  onInstanceChange: (id: string) => void;
  onProviderChange: (provider: ProviderId) => void;
  origin: string;
  models: HeylookModel[] | null;
  modelId: string | null;
  onModelChange: (id: string) => void;
  presets?: HeylookPreset[] | null;
  onImportPreset?: (preset: HeylookPreset) => void;
  appliedPreset?: PresetProvenance | null;
  temperature?: number | null;
  onTemperatureChange?: (val: number | null) => void;
  topP?: number | null;
  onTopPChange?: (val: number | null) => void;
  maxOutputTokens?: number | null;
  onMaxOutputTokensChange?: (val: number | null) => void;
  contextSize?: number;
  onContextSizeChange?: (size: number) => void;
  discovering: boolean;
  /** Non-null while a model is being made resident, naming which. */
  loadingModel: string | null;
  error: string | null;
  onRefresh: () => void;
  /** Disable controls when generation is busy */
  disabled?: boolean;
  busy?: boolean;
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
  thinking,
  onThinkingChange,
  heylookToken,
  onHeylookTokenChange,
  instances,
  instanceId,
  onInstanceChange,
  onProviderChange,
  origin,
  models,
  modelId,
  onModelChange,
  presets,
  onImportPreset,
  appliedPreset,
  temperature,
  onTemperatureChange,
  topP,
  onTopPChange,
  maxOutputTokens,
  onMaxOutputTokensChange,
  contextSize,
  onContextSizeChange,
  discovering,
  loadingModel,
  error,
  onRefresh,
  disabled,
  busy,
}: Props) {
  const isDisabled = Boolean(disabled ?? busy);
  // See the token input below. The field is a draft only; it never renders
  // the stored secret.
  const [tokenDraft, setTokenDraft] = useState('');
  return (
    <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
      <select
        value={provider}
        onChange={(event) => onProviderChange(event.target.value as ProviderId)}
        disabled={isDisabled}
        className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
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
              disabled={isDisabled}
              className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
              title="Which configured machine to talk to. Each has its own model roster."
            >
              {instances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.id}
                </option>
              ))}
            </select>
          )}

          {/*
            Three states, not a checkbox, because `auto` is not a synonym for
            off: it omits the field so heylook's own cascade decides, which
            since 1.79.62 resolves to the model's config and then to whether it
            can think at all. Sending `false` overrides that from here, which is
            what the app did to every capable model before this control existed.
          */}
          <select
            value={thinking.mode}
            onChange={(event) =>
              onThinkingChange({ mode: event.target.value as ThinkingPreference['mode'] })
            }
            disabled={isDisabled}
            className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
            title="Thinking: auto sends no switch and lets the server decide; on and off state an opinion. Only reaches a model whose row advertises the capability."
          >
            <option value="off">thinking: off</option>
            <option value="auto">thinking: auto</option>
            <option value="on">thinking: on</option>
          </select>

          {/*
            A DRAFT plus an explicit Save, and it took two attempts to get
            here. The first version wrote to the vault on every keystroke: the
            input was controlled by state that only updated after an await, so
            each keystroke fought its own re-render and every one of them
            started another `setSecret`. Typing `lan-token-xyz` and reloading
            gave back the single character `z`.

            The second version kept a draft and persisted on blur. Also wrong,
            and wrong in a way worth recording rather than quietly replacing:
            blur is a timing dependency, and a field that saves on an event you
            cannot see is one whose failure you also cannot see.

            The Gemini key next door has a Save button, and it has one for
            exactly this reason. Matching it is not chrome, it is the version
            with no invisible moment in it. The field never shows the stored
            secret -- the placeholder says whether one exists, which is all a
            reader needs and all this can honestly offer for a value it holds
            encrypted.

            Blank is the normal state, because heylook's key is loopback-exempt:
            a server on this machine needs nothing. It becomes required the day
            one is started with a non-loopback host, which is the same day
            cross-machine access starts working -- so the field is always shown
            rather than hidden behind a toggle nobody would find at that moment.

            No passphrase option, unlike the Gemini key, and the reason is in
            `HEYLOOK_TOKEN_NAME`: this gates a local server rather than a
            metered API.
          */}
          <input
            type="password"
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            disabled={isDisabled}
            placeholder={heylookToken ? 'token saved' : 'token (only if the server asks)'}
            className="w-[150px] rounded border border-[var(--color-edge)] bg-transparent px-1.5 py-0.5 disabled:opacity-40"
            title="Sent as a bearer token on generation and cancel. Type it and press Save. heylook exempts loopback by default, so leave this empty for a server on this machine."
          />
          <button
            type="button"
            onClick={() => {
              onHeylookTokenChange(tokenDraft);
              setTokenDraft('');
            }}
            disabled={isDisabled}
            className="rounded border border-[var(--color-edge)] px-1.5 py-0.5 disabled:opacity-40"
            title={heylookToken ? 'Replace the saved token, or save an empty field to clear it' : 'Save this token'}
          >
            {heylookToken && !tokenDraft ? 'Clear' : 'Save'}
          </button>

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
              disabled={isDisabled}
              className="max-w-[220px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
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

          {onContextSizeChange && (
            <select
              value={
                contextSize === 0
                  ? '0'
                  : contextSize === 32768
                    ? '32768'
                    : contextSize === 65536
                      ? '65536'
                      : contextSize === 128000
                        ? '128000'
                        : contextSize === 131072
                          ? '131072'
                          : contextSize === 262144
                            ? '262144'
                            : contextSize === 1048576
                              ? '1048576'
                              : contextSize !== undefined
                                ? String(contextSize)
                                : '128000'
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  const typed = window.prompt(
                    'Custom context size in tokens (e.g. 128000, 0 for auto):',
                    String(contextSize ?? 128000),
                  );
                  if (typed !== null) {
                    const n = parseInt(typed.replace(/[,_]/g, ''), 10);
                    if (Number.isFinite(n) && n >= 0) onContextSizeChange(n);
                  }
                } else {
                  onContextSizeChange(Number(val));
                }
              }}
              disabled={isDisabled}
              className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
              title="Model load context size: sent with load/reload (defaults to 128,000; 0 is Auto)."
            >
              <option value="128000">ctx: 128k (default)</option>
              <option value="0">ctx: auto</option>
              <option value="32768">ctx: 32k</option>
              <option value="65536">ctx: 64k</option>
              <option value="131072">ctx: 131k (2¹⁷)</option>
              <option value="262144">ctx: 256k</option>
              <option value="1048576">ctx: 1M</option>
              {contextSize !== undefined &&
                contextSize !== 0 &&
                contextSize !== 32768 &&
                contextSize !== 65536 &&
                contextSize !== 128000 &&
                contextSize !== 131072 &&
                contextSize !== 262144 &&
                contextSize !== 1048576 && (
                  <option value={String(contextSize)}>ctx: {contextSize.toLocaleString()}</option>
                )}
              <option value="custom">ctx: custom…</option>
            </select>
          )}

          {presets != null && presets.length > 0 && onImportPreset && (
            <div className="flex items-center gap-1">
              <select
                id="heylook-preset-select"
                defaultValue=""
                onChange={(e) => {
                  const selected = presets.find((p) => p.id === e.target.value);
                  if (selected) {
                    onImportPreset(selected);
                    e.target.value = '';
                  }
                }}
                disabled={isDisabled}
                className="max-w-[130px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
                title="Select a server preset to import its samplers and creative direction."
              >
                <option value="">import preset…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {appliedPreset && (
                <span
                  className="rounded bg-[var(--color-edge)]/50 px-1 py-0.5 text-[9px] text-[var(--color-muted)]"
                  title={`Applied preset: ${appliedPreset.name} (id: ${appliedPreset.id})`}
                >
                  preset: {appliedPreset.name}
                </span>
              )}
            </div>
          )}

          {onTemperatureChange && (
            <input
              type="number"
              step={0.05}
              min={0}
              max={2}
              value={temperature ?? ''}
              onChange={(e) => onTemperatureChange(e.target.value ? Number(e.target.value) : null)}
              disabled={isDisabled}
              placeholder="temp"
              className="w-[50px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 text-[10px] disabled:opacity-40"
              title="Sampling temperature (e.g. 1.0). Leave empty to use model default."
            />
          )}

          {onTopPChange && (
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={topP ?? ''}
              onChange={(e) => onTopPChange(e.target.value ? Number(e.target.value) : null)}
              disabled={isDisabled}
              placeholder="top_p"
              className="w-[50px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 text-[10px] disabled:opacity-40"
              title="Nucleus sampling top_p (e.g. 0.9). Leave empty to use model default."
            />
          )}

          {onMaxOutputTokensChange && (
            <input
              type="number"
              step={1024}
              min={512}
              max={65536}
              value={maxOutputTokens ?? ''}
              onChange={(e) => onMaxOutputTokensChange(e.target.value ? Number(e.target.value) : null)}
              disabled={isDisabled}
              placeholder="max_tok"
              className="w-[60px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 text-[10px] disabled:opacity-40"
              title="Max output tokens override. Leave empty to use task ceiling."
            />
          )}

          {!discovering && error && (
            <span className="max-w-[320px] truncate text-[var(--color-danger)]" title={error}>
              {error}
            </span>
          )}

          <button
            type="button"
            onClick={onRefresh}
            className="underline disabled:opacity-40"
            disabled={discovering || isDisabled}
          >
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
            disabled={isDisabled}
            className="rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
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
              disabled={isDisabled}
              className="w-[140px] rounded border border-[var(--color-edge)] bg-transparent px-1 py-0.5 disabled:opacity-40"
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

    </div>
  );
}
