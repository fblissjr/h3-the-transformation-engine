/**
 * System Prompts Customizer Modal.
 *
 * Lets the user inspect, edit, save to SQLite, and reset any system prompt
 * throughout the engine.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  PROMPT_DEFINITIONS,
  getPromptDefault,
  resolvePrompt,
} from '../../provider/prompts/registry';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  promptOverrides: Record<string, string>;
  onSaveOverride: (id: string, text: string) => Promise<void>;
  onResetOverride: (id: string) => Promise<void>;
  onResetAll: () => Promise<void>;
}

export function PromptModal({
  isOpen,
  onClose,
  promptOverrides,
  onSaveOverride,
  onResetOverride,
  onResetAll,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(PROMPT_DEFINITIONS[0].id);
  const [draft, setDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  const selectedDef = useMemo(
    () => PROMPT_DEFINITIONS.find((p) => p.id === selectedId) ?? PROMPT_DEFINITIONS[0],
    [selectedId],
  );

  const activePromptText = useMemo(
    () => resolvePrompt(selectedDef.id, promptOverrides),
    [selectedDef.id, promptOverrides],
  );

  const defaultText = useMemo(
    () => getPromptDefault(selectedDef.id) ?? '',
    [selectedDef.id],
  );

  const isCustomizedInDb = Boolean(
    promptOverrides[selectedDef.id] && promptOverrides[selectedDef.id].trim() !== '',
  );

  // Sync draft when selected prompt changes or override changes
  useEffect(() => {
    setDraft(activePromptText);
  }, [activePromptText]);

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isDraftDirty = draft !== activePromptText;
  const isDraftDifferentFromDefault = draft !== defaultText;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveOverride(selectedDef.id, draft);
    } finally {
      setSaving(false);
    }
  };

  const handleResetCurrent = async () => {
    setSaving(true);
    try {
      await onResetOverride(selectedDef.id);
      setDraft(defaultText);
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (
      !window.confirm(
        'Reset all prompts to built-in defaults? This will erase all custom prompt overrides in the database.',
      )
    ) {
      return;
    }
    setResettingAll(true);
    try {
      await onResetAll();
      setDraft(getPromptDefault(selectedDef.id) ?? '');
    } finally {
      setResettingAll(false);
    }
  };

  const customizedCount = Object.keys(promptOverrides).filter(
    (k) => promptOverrides[k] && promptOverrides[k].trim() !== '',
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-edge)] px-6 py-4 bg-black/20">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold text-white">System Prompt Configuration</h2>
              {customizedCount > 0 ? (
                <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-300 border border-amber-500/30">
                  {customizedCount} customized in DB
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-[var(--color-muted)]">
                  All defaults active
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              All system prompts are customizable. Overrides persist in SQLite and fall back to built-in defaults when reset.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
          {/* Sidebar */}
          <div className="flex flex-col border-r border-[var(--color-edge)] bg-black/10 overflow-y-auto p-3 space-y-1">
            <span className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Prompts
            </span>
            {PROMPT_DEFINITIONS.map((p) => {
              const hasOverride = Boolean(
                promptOverrides[p.id] && promptOverrides[p.id].trim() !== '',
              );
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`flex flex-col rounded-lg p-2.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 border border-blue-500/40 text-white'
                      : 'hover:bg-white/5 text-gray-300 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-medium">{p.title}</span>
                    {hasOverride && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Customized in DB" />
                    )}
                  </div>
                  <span className="mt-1 line-clamp-1 text-[10px] text-[var(--color-muted)]">
                    {p.id}
                  </span>
                </button>
              );
            })}

            <div className="mt-auto pt-4 border-t border-[var(--color-edge)]/50">
              <button
                type="button"
                disabled={resettingAll || customizedCount === 0}
                onClick={handleResetAll}
                className="w-full rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-30 transition-colors"
              >
                {resettingAll ? 'Resetting...' : 'Reset All to Defaults'}
              </button>
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex flex-col min-h-0 p-4 space-y-3 bg-black/5">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{selectedDef.title}</h3>
                  {isCustomizedInDb ? (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30">
                      Saved in Database
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
                      Built-in Default
                    </span>
                  )}
                  {isDraftDirty && (
                    <span className="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-300">
                      Unsaved Changes
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">{selectedDef.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || (!isCustomizedInDb && !isDraftDifferentFromDefault)}
                  onClick={handleResetCurrent}
                  className="rounded border border-[var(--color-edge)] bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 disabled:opacity-40 transition-colors"
                >
                  Reset to Default
                </button>
                <button
                  type="button"
                  disabled={saving || !isDraftDirty}
                  onClick={handleSave}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors shadow-sm"
                >
                  {saving ? 'Saving...' : 'Save to DB'}
                </button>
              </div>
            </div>

            {/* Prompt Editor */}
            <div className="flex-1 min-h-0 flex flex-col">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full flex-1 resize-none rounded-lg border border-[var(--color-edge)] bg-black/40 p-3 font-mono text-xs leading-relaxed text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)] pt-1">
              <span>Length: {draft.length} characters ({draft.split(/\s+/).filter(Boolean).length} words)</span>
              <span>Key: <code className="text-gray-300">{selectedDef.id}</code></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
