/**
 * The one piece of application state.
 *
 * Deliberately a single hook rather than a set of contexts. This app is one
 * document and one rendered view of it; the previous project had seven
 * contexts and the indirection cost more than it bought.
 *
 * The invariant everything else depends on: `rendered` and `validation` are
 * always derived from `doc`. They are never set independently, so the prompt on
 * screen cannot disagree with the document behind it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CompileInput, H3Document, ReferenceSlot } from '../core/ir/types';
import type { H3Mode } from '../core/ir/vocab';
import { contextFor, framesToSeconds } from '../core/normalize';
import { inferMode } from '../core/normalize/mode';
import { compile, edit, editDirect, inspect } from '../pipeline';
import { GeminiClient } from '../provider/gemini';
import { API_KEY_NAME, getSecret, hasSecret, setSecret } from '../crypto/secureStore';
import { buildTree, flattenTree, listVersions, recordVersion } from '../db/versions';
import { loadDocument, saveDocument, type StoredVersion } from '../db/db';

const DOC_ID = 'workspace';

export interface EngineState {
  apiKey: string | null;
  idea: string;
  mode: H3Mode | null;
  durationFrames: number | null;
  durationSeconds: number;
  slots: ReferenceSlot[];
  doc: H3Document | null;
  selectedPaths: string[];
  versions: StoredVersion[];
  headVersionId: string | null;
  busy: string | null;
  error: string | null;
  notice: string | null;
}

export function useEngine() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [idea, setIdea] = useState('');
  const [modeOverride, setModeOverride] = useState<H3Mode | null>(null);
  const [durationFrames, setDurationFrames] = useState<number | null>(192);
  const [durationSeconds, setDurationSeconds] = useState(8);
  const [slots, setSlots] = useState<ReferenceSlot[]>([]);
  const [doc, setDoc] = useState<H3Document | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [versions, setVersions] = useState<StoredVersion[]>([]);
  const [headVersionId, setHeadVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- persistence -------------------------------------------------------
  useEffect(() => {
    void (async () => {
      if (hasSecret(API_KEY_NAME)) setApiKey(await getSecret(API_KEY_NAME));
      const stored = await loadDocument(DOC_ID);
      if (stored) {
        setDoc(stored.doc);
        setHeadVersionId(stored.headVersionId);
        setSlots(stored.doc.slots);
        setDurationFrames(stored.doc.durationFrames);
        setDurationSeconds(stored.doc.durationSeconds);
        setModeOverride(stored.doc.modeLocked ? stored.doc.mode : null);
      }
      setVersions(await listVersions(DOC_ID));
    })();
  }, []);

  const saveApiKey = useCallback(async (value: string) => {
    await setSecret(API_KEY_NAME, value.trim());
    setApiKey(value.trim());
  }, []);

  // --- derived -----------------------------------------------------------
  const inference = useMemo(() => inferMode(slots), [slots]);
  const mode: H3Mode = modeOverride ?? inference.mode;

  const view = useMemo(() => (doc ? inspect(doc) : null), [doc]);

  const input = useMemo<CompileInput>(
    () => ({
      idea,
      mode,
      ...(durationFrames != null ? { durationFrames } : { durationSeconds }),
      slots,
    }),
    [idea, mode, durationFrames, durationSeconds, slots],
  );

  const client = useMemo(() => (apiKey ? new GeminiClient({ apiKey }) : null), [apiKey]);

  // --- persistence of a new document state --------------------------------
  const commit = useCallback(
    async (
      next: H3Document,
      label: string,
      operations?: Parameters<typeof recordVersion>[0]['operations'],
    ) => {
      const version = await recordVersion({
        documentId: DOC_ID,
        parentId: headVersionId,
        doc: next,
        label,
        ...(operations ? { operations } : {}),
      });
      await saveDocument({
        id: DOC_ID,
        title: label,
        updatedAt: Date.now(),
        doc: next,
        headVersionId: version.id,
      });
      setDoc(next);
      setHeadVersionId(version.id);
      setVersions(await listVersions(DOC_ID));
    },
    [headVersionId],
  );

  // --- actions -----------------------------------------------------------
  const generate = useCallback(async () => {
    if (!client) return setError('Add a Gemini API key first.');
    if (idea.trim() === '') return setError('Describe what you want before generating.');
    setBusy('Planning');
    setError(null);
    setNotice(null);
    try {
      const result = await compile(client, input, { id: DOC_ID });
      await commit(result.doc, 'Generated');
      setSelectedPaths([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [client, idea, input, commit]);

  const applyDirect = useCallback(
    async (path: string, value: unknown) => {
      if (!doc) return;
      const result = editDirect(doc, path, value);
      if (result.patch.rejected.length > 0) {
        setError(result.patch.rejected[0].reason);
        return;
      }
      await commit(result.doc, `Edited ${path}`, result.patch.applied);
    },
    [doc, commit],
  );

  const applyAssisted = useCallback(
    async (instruction: string) => {
      if (!client) return setError('Add a Gemini API key first.');
      if (!doc) return;
      if (selectedPaths.length === 0) return setError('Select something to edit first.');
      setBusy('Editing');
      setError(null);
      setNotice(null);
      try {
        const result = await edit(client, doc, selectedPaths, instruction);
        if (result.patch.applied.length === 0) {
          setError(
            result.patch.rejected[0]?.reason ?? 'The model returned no applicable changes.',
          );
          return;
        }
        await commit(result.doc, instruction.slice(0, 60), result.patch.applied);
        // Rejections and declines are surfaced, never swallowed -- a partially
        // applied edit that looks complete is the failure mode that makes
        // surgical editing untrustworthy.
        const skipped = [
          ...result.patch.rejected.map((r) => `${r.path}: ${r.reason}`),
          ...result.patch.declined.map((d) => `declined ${d.what}: ${d.why}`),
        ];
        if (skipped.length > 0) setNotice(`Applied ${result.patch.applied.length}. Skipped: ${skipped.join('; ')}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [client, doc, selectedPaths, commit],
  );

  const checkout = useCallback(async (version: StoredVersion) => {
    setDoc(version.doc);
    setHeadVersionId(version.id);
    setSlots(version.doc.slots);
    await saveDocument({
      id: DOC_ID,
      title: version.label,
      updatedAt: Date.now(),
      doc: version.doc,
      headVersionId: version.id,
    });
    // Editing from here branches rather than overwriting: the next commit takes
    // this version as its parent.
    setNotice(`Checked out "${version.label}". Editing from here will branch.`);
  }, []);

  const togglePath = useCallback((path: string, additive: boolean) => {
    setSelectedPaths((current) => {
      if (!additive) return current.length === 1 && current[0] === path ? [] : [path];
      return current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
    });
  }, []);

  const setFrames = useCallback((frames: number | null) => {
    setDurationFrames(frames);
    if (frames != null) setDurationSeconds(framesToSeconds(frames));
  }, []);

  const versionTree = useMemo(() => flattenTree(buildTree(versions)), [versions]);
  const ctx = useMemo(() => (doc ? contextFor(doc) : null), [doc]);

  return {
    apiKey,
    saveApiKey,
    idea,
    setIdea,
    mode,
    modeOverride,
    setModeOverride,
    inference,
    durationFrames,
    durationSeconds,
    setFrames,
    setDurationSeconds,
    slots,
    setSlots,
    doc,
    ctx,
    view,
    selectedPaths,
    togglePath,
    setSelectedPaths,
    versions: versionTree,
    headVersionId,
    busy,
    error,
    setError,
    notice,
    setNotice,
    generate,
    applyDirect,
    applyAssisted,
    checkout,
  };
}

export type Engine = ReturnType<typeof useEngine>;
