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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompileInput, H3Document, ReferenceSlot } from '../core/ir/types';
import type { H3Mode } from '../core/ir/vocab';
import type { CreativeModeRecord } from '../core/creative';
import { describeRecord, hasDirection, pruneRecord, sameRecord } from '../core/creative';
import { hasPlaceholders, newSeed, rollRecord, rollSeeded } from '../core/wildcards';
import { contextFor, framesToSeconds } from '../core/normalize';
import { inferMode } from '../core/normalize/mode';
import { compile, edit, editDirect, inspect } from '../pipeline';
import { GeminiClient } from '../provider/gemini';
import type { InferenceClient, ProviderId } from '../provider/types';
import {
  HeylookClient,
  HEYLOOK_ORIGIN,
  listModels,
  pickDefaultModel,
  type HeylookModel,
} from '../provider/heylook';
import {
  API_KEY_NAME,
  DEFAULT_KEY_MODE,
  getSecret,
  removeSecret,
  secretMode,
  setSecret,
  type KeyMode,
  type WritableKeyMode,
} from '../crypto/secureStore';
import { buildTree, flattenTree, listVersions, recordVersion } from '../db/versions';
import { getSetting, loadDocument, saveDocument, setSetting, type StoredVersion } from '../db/db';
import type { EraseScope } from '../db/wipe';

const DOC_ID = 'workspace';

/**
 * Which backend to use, and which local model.
 *
 * Settings rather than component state: the choice has to survive a reload, and
 * a build that came back on Gemini after the user had picked a local model
 * would spend a paid call on what they thought was a free one.
 *
 * The model id is stored on its own, not the whole capability row. A roster is
 * whatever the server has today, so a stored row could describe a model that no
 * longer exists or whose capabilities have changed; the id is re-resolved
 * against the live roster and dropped if it is not there.
 */
const PROVIDER_SETTING = 'provider';
const HEYLOOK_MODEL_SETTING = 'heylook-model';

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

/**
 * A stored creative mode, with any pack or glitch mark this build no longer
 * has dropped.
 *
 * The picker shows exactly what it holds, so an id that cannot render as a
 * selected option must not stay in the record either.
 */
function restoreCreative(stored: CreativeModeRecord | undefined): CreativeModeRecord | null {
  if (!stored) return null;
  return pruneRecord(stored);
}

/** Stands in for "no direction", so a comparison never has to special-case null. */
const EMPTY_RECORD = { mode: 'directed', selection: { strength: 'full' } } as const;

export function useEngine() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  /**
   * Which backend the next call goes to.
   *
   * Gemini stays the default because it needs no server running. The choice is
   * explicit rather than inferred from what is reachable: a silent fallback to
   * a paid hosted API because the local server was down is exactly the surprise
   * this app should not spring on anyone.
   */
  const [provider, setProviderState] = useState<ProviderId>('gemini');
  /** The live roster, or null before discovery has been attempted. */
  const [heylookModels, setHeylookModels] = useState<HeylookModel[] | null>(null);
  const [heylookModelId, setHeylookModelId] = useState<string | null>(null);
  /**
   * The same id, readable without becoming a dependency.
   *
   * Discovery has to know which model was selected in order to say that it has
   * gone, but taking it as a dependency would make choosing a model re-trigger
   * the discovery effect that chose it. Reading it inside the state updater is
   * the other wrong answer: an updater must be pure, and React is free to run
   * it twice.
   */
  const heylookModelIdRef = useRef<string | null>(null);
  /**
   * The in-flight model call, so it can be stopped.
   *
   * One controller rather than one per action: `busy` already enforces that at
   * most one call is running, and a stop button that has to know which kind of
   * call it is stopping would be a second copy of that fact.
   *
   * Stopping is provider-agnostic on purpose. `CallOptions.signal` has been on
   * the interface since it was extracted and both clients thread it through, so
   * this needed a control rather than a mechanism. It matters most on the local
   * server, which serialises generation: an abandoned generation there is not
   * just a wasted wait, it is the queue everything else is behind.
   */
  const abortRef = useRef<AbortController | null>(null);
  const [heylookError, setHeylookError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  /** What is on disk, independent of whether it has been unlocked this session. */
  const [storedKeyMode, setStoredKeyMode] = useState<KeyMode | null>(null);
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
  /**
   * The single copy of the creative selection.
   *
   * It lives here rather than inside the picker so that a reload, a checkout
   * and an erase all put the controls and the document in the same state. A
   * picker holding its own copy agrees with this one exactly once, at mount.
   */
  const [creative, setCreative] = useState<CreativeModeRecord | null>(null);
  /**
   * The wildcard seed, or null when nothing has been rolled.
   *
   * The idea box keeps the template, braces and all, and the roll is derived
   * from it. Writing the rolled text back into the box would spend the template
   * on its first use -- there would be nothing left with a `{setting}` in it to
   * roll again, and the seed would have nothing to be a seed of.
   */
  const [seed, setSeed] = useState<number | null>(null);

  // --- persistence -------------------------------------------------------
  useEffect(() => {
    void (async () => {
      // A passphrase-mode secret cannot be read without the passphrase, so the
      // UI has to distinguish "no key yet" from "key present but locked".
      // Treating both as absent would silently ask the user to paste their key
      // again and overwrite a perfectly good stored one.
      const mode = secretMode(API_KEY_NAME);
      setStoredKeyMode(mode);

      if (mode === 'origin' || mode === 'device') {
        const value = await getSecret(API_KEY_NAME);
        if (value != null) setApiKey(value);
        else {
          // Neither mode can be retried: `origin` fails only when the wrapping
          // key is gone, `device` when the browser fingerprint moved. Keeping
          // the dead blob would leave the UI insisting a key exists that can
          // never open, so it goes and the user is told why.
          removeSecret(API_KEY_NAME);
          setStoredKeyMode(null);
          setNotice('The stored API key could not be decrypted on this browser. Paste it again.');
        }
      }

      const storedProvider = await getSetting<ProviderId>(PROVIDER_SETTING, 'gemini');
      if (storedProvider === 'heylook' || storedProvider === 'gemini') {
        setProviderState(storedProvider);
      }
      const storedModel = await getSetting<string | null>(HEYLOOK_MODEL_SETTING, null);
      heylookModelIdRef.current = storedModel;
      setHeylookModelId(storedModel);

      const stored = await loadDocument(DOC_ID);
      if (stored) {
        const { record, schemaError } = stored;
        setDoc(record.doc);
        setHeadVersionId(record.headVersionId);
        setSlots(record.doc.slots);
        setDurationFrames(record.doc.durationFrames);
        setDurationSeconds(record.doc.durationSeconds);
        setModeOverride(record.doc.modeLocked ? record.doc.mode : null);
        setCreative(restoreCreative(record.doc.creativeMode));
        if (record.doc.roll) {
          setIdea(record.doc.roll.template);
          setSeed(record.doc.roll.seed);
        }
        if (schemaError) {
          const schemaNotice =
            `The stored document does not match this build's schema (${schemaError}). ` +
            'It has been opened anyway; check it before editing.';
          // Appended, not assigned: the key notice a few lines above says the
          // stored key is gone and has to be pasted again, which is not
          // something to drop because a second thing also went wrong.
          setNotice((current) => (current ? `${current} ${schemaNotice}` : schemaNotice));
        }
      }
      setVersions(await listVersions(DOC_ID));
    })();
  }, []);

  /**
   * Store the key.
   *
   * With a passphrase it is genuinely confidential at rest; without one it is
   * obfuscated against a casual look at localStorage and nothing more. The UI
   * says which, because a user who thinks the weaker mode is encryption may
   * make a worse decision about whose machine they run this on.
   */
  const saveApiKey = useCallback(async (value: string, passphrase?: string) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      setError('Paste a key before saving.');
      return;
    }
    const mode: WritableKeyMode = passphrase ? 'passphrase' : DEFAULT_KEY_MODE;
    try {
      await setSecret(API_KEY_NAME, trimmed, { mode, ...(passphrase ? { passphrase } : {}) });
    } catch (cause) {
      // Storing the key can fail for real -- a browser with IndexedDB disabled
      // has nowhere to put the wrapping key. Letting that reject unhandled left
      // the form looking like it had saved when it had not.
      setError(
        `Could not store the key: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      return;
    }
    setApiKey(trimmed);
    setStoredKeyMode(mode);
    setError(null);
  }, []);

  /** Unlock a passphrase-mode key that was stored in an earlier session. */
  const unlockApiKey = useCallback(async (passphrase: string) => {
    const value = await getSecret(API_KEY_NAME, passphrase);
    if (value == null) {
      setError('That passphrase does not unlock the stored key.');
      return false;
    }
    setApiKey(value);
    setError(null);
    return true;
  }, []);

  const forgetApiKey = useCallback(() => {
    removeSecret(API_KEY_NAME);
    setApiKey(null);
    setStoredKeyMode(null);
  }, []);

  /**
   * Drop the in-memory mirror of whatever was just erased.
   *
   * Without this the document stays on screen beside a report saying the
   * database is empty, and the next edit writes it straight back -- which would
   * make the erase both untrustworthy and untrue.
   */
  const resetAfterErase = useCallback((scope: EraseScope) => {
    setDoc(null);
    setVersions([]);
    setHeadVersionId(null);
    setSelectedPaths([]);
    setSlots([]);
    setModeOverride(null);
    setCreative(null);
    setSeed(null);
    // The provider choice and the model id live in the `settings` store, which
    // the erase deletes on both scopes. Leaving them on screen would be the
    // creative-picker bug again: a header claiming a selection that storage no
    // longer holds, which a reload then silently drops back to the default.
    setProviderState('gemini');
    setHeylookModels(null);
    heylookModelIdRef.current = null;
    setHeylookModelId(null);
    setHeylookError(null);
    if (scope === 'everything') {
      setApiKey(null);
      setStoredKeyMode(null);
    }
    setError(null);
    setNotice(
      scope === 'everything'
        ? 'Erased the workspace, its history, and the stored key.'
        : 'Erased the workspace and its history. Your API key is still stored.',
    );
  }, []);

  // --- derived -----------------------------------------------------------
  const inference = useMemo(() => inferMode(slots), [slots]);
  const mode: H3Mode = modeOverride ?? inference.mode;

  const view = useMemo(() => (doc ? inspect(doc) : null), [doc]);

  /**
   * The idea as it will actually be compiled.
   *
   * Expansion happens here, on the way into `CompileInput`, and nowhere later:
   * a document assembled from unexpanded text would render a literal
   * `{setting}` into the H3 prompt, and the prompt is a pure function of the
   * document, so there is no downstream place to fix it.
   */
  const rolled = useMemo(
    () => (seed != null && hasPlaceholders(idea) ? rollSeeded(idea, seed) : null),
    [idea, seed],
  );
  const effectiveIdea = rolled?.text ?? idea;

  const input = useMemo<CompileInput>(() => {
    // Hoisted: this runs a full seeded roll of the template, and it was being
    // called twice in one expression to satisfy a non-null assertion.
    const record = rollRecord(idea, seed);
    return {
      idea: effectiveIdea,
      mode,
      ...(durationFrames != null ? { durationFrames } : { durationSeconds }),
      slots,
      // A mode with nothing chosen in it contributes nothing, and should not
      // be stamped onto the document as though it did. Glitch marks count as
      // something chosen: a record carrying only marks and no packs is a
      // complete direction, and gating on the style alone would silently drop
      // it on the way to the planner.
      ...(creative && hasDirection(creative) ? { creativeMode: creative } : {}),
      ...(record ? { roll: record } : {}),
    };
  }, [effectiveIdea, idea, seed, mode, durationFrames, durationSeconds, slots, creative]);

  /**
   * Ask the server what it is serving.
   *
   * Model ids are install-local -- heylook serves whatever is under a scanned
   * folder, so the roster changes when a model is downloaded, with no config
   * edit and no restart. There is nothing sensible to hard-code, so the list is
   * always the live one and a stored id is only honoured if it is still there.
   */
  const refreshHeylookModels = useCallback(async () => {
    setDiscovering(true);
    setHeylookError(null);
    try {
      const models = await listModels();
      setHeylookModels(models);

      const current = heylookModelIdRef.current;
      if (current == null || !models.some((m) => m.id === current)) {
        const replacement = pickDefaultModel(models)?.id ?? null;
        // The roster is whatever the server has today, so a stored id can
        // simply be gone -- renamed, moved out of a scanned folder, deleted.
        // Substituting another one silently would mean the next generation ran
        // on a model the user never chose, and the picker would agree with
        // itself while disagreeing with what they last set.
        if (current != null) {
          setNotice(
            `heylook is no longer serving ${current}. Selected ${replacement ?? 'nothing'} instead.`,
          );
        }
        heylookModelIdRef.current = replacement;
        setHeylookModelId(replacement);
      }
      if (models.length === 0) {
        setHeylookError(
          `heylook at ${HEYLOOK_ORIGIN} is running but serving no models. Point it at a model ` +
            'folder, or download one.',
        );
      }
    } catch (cause) {
      setHeylookModels([]);
      setHeylookError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDiscovering(false);
    }
  }, []);

  // Discover on switching to heylook, and once on load if that is the stored
  // choice. Not on an interval: the roster only changes when the owner does
  // something, and there is a refresh button for that.
  useEffect(() => {
    if (provider !== 'heylook' || heylookModels != null) return;
    void refreshHeylookModels();
  }, [provider, heylookModels, refreshHeylookModels]);

  const setProvider = useCallback((next: ProviderId) => {
    setProviderState(next);
    setError(null);
    void setSetting(PROVIDER_SETTING, next);
  }, []);

  const setHeylookModel = useCallback((id: string) => {
    heylookModelIdRef.current = id;
    setHeylookModelId(id);
    void setSetting(HEYLOOK_MODEL_SETTING, id);
  }, []);

  const heylookModel = useMemo(
    () => heylookModels?.find((m) => m.id === heylookModelId) ?? null,
    [heylookModels, heylookModelId],
  );

  /**
   * The client the pipeline gets, or null when this provider is not ready.
   *
   * Null is what the generate button reads, and the two backends are not ready
   * for the same reasons: Gemini needs a key, heylook needs a reachable server
   * with a model chosen on it. Each says so in its own words rather than
   * sharing one message that fits neither.
   */
  const client = useMemo<InferenceClient | null>(() => {
    if (provider === 'heylook') {
      return heylookModel ? new HeylookClient({ model: heylookModel }) : null;
    }
    return apiKey ? new GeminiClient({ apiKey }) : null;
  }, [provider, apiKey, heylookModel]);

  /** Why the generate button cannot fire, in this provider's terms. */
  const notReady = useMemo(() => {
    if (client) return null;
    if (provider === 'gemini') return 'Add a Gemini API key first.';
    if (discovering) return 'Still asking heylook what it is serving.';
    return heylookError ?? `Choose a model on heylook at ${HEYLOOK_ORIGIN} first.`;
  }, [client, provider, discovering, heylookError]);

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

  /**
   * An aborted call is a thing the user did, not a thing that went wrong.
   *
   * It arrives as an `AbortError` DOMException from `fetch`, or wrapped by the
   * SDK on the hosted path, so both spellings are recognised. Reporting it as an
   * error would put a red bar on screen for pressing stop.
   */
  const reportOrStopped = useCallback((cause: unknown) => {
    const aborted =
      (cause instanceof DOMException && cause.name === 'AbortError') ||
      (cause instanceof Error && cause.name === 'AbortError');
    if (aborted) {
      setNotice('Stopped. Nothing was saved -- a stopped call returns no document.');
      return;
    }
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  /**
   * Stop the call in flight.
   *
   * Aborting the request is also what tells a local server to give up on the
   * generation, which is the part that matters when it serialises work: the
   * queue behind it moves as soon as this returns.
   */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // --- actions -----------------------------------------------------------
  const generate = useCallback(async () => {
    if (!client) return setError(notReady ?? 'No inference backend is ready.');
    if (effectiveIdea.trim() === '') return setError('Describe what you want before generating.');
    setBusy('Planning');
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await compile(client, input, { id: DOC_ID, signal: controller.signal });
      const style = describeRecord(creative);
      // The seed goes in the label because it is the only record of which roll
      // produced this document; the idea box still holds the template.
      const parts = [style, rolled ? `seed ${seed}` : ''].filter((p) => p !== '');
      const label = parts.length === 0 ? 'Generated' : `Generated (${parts.join(', ')})`;
      await commit(result.doc, label);
      setSelectedPaths([]);
    } catch (cause) {
      reportOrStopped(cause);
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }, [client, notReady, effectiveIdea, input, commit, creative, rolled, seed, reportOrStopped]);

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
      if (!client) return setError(notReady ?? 'No inference backend is ready.');
      if (!doc) return;
      if (selectedPaths.length === 0) return setError('Select something to edit first.');
      setBusy('Editing');
      setError(null);
      setNotice(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await edit(client, doc, selectedPaths, instruction, {
          signal: controller.signal,
        });
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
        reportOrStopped(cause);
      } finally {
        abortRef.current = null;
        setBusy(null);
      }
    },
    [client, notReady, doc, selectedPaths, commit, reportOrStopped],
  );

  const checkout = useCallback(async (version: StoredVersion) => {
    setDoc(version.doc);
    setHeadVersionId(version.id);
    setSlots(version.doc.slots);
    setCreative(restoreCreative(version.doc.creativeMode));
    // A version records the template as well as the seed, so checking one out
    // puts the idea box back in the state that produced it.
    if (version.doc.roll) {
      setIdea(version.doc.roll.template);
      setSeed(version.doc.roll.seed);
    } else {
      setSeed(null);
    }
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
    storedKeyMode,
    provider,
    setProvider,
    heylookOrigin: HEYLOOK_ORIGIN,
    heylookModels,
    heylookModelId,
    setHeylookModel,
    heylookError,
    discovering,
    refreshHeylookModels,
    /** Null when a call can be made; otherwise why not, in this provider's terms. */
    notReady,
    saveApiKey,
    unlockApiKey,
    forgetApiKey,
    resetAfterErase,
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
    stop,
    error,
    setError,
    notice,
    setNotice,
    generate,
    applyDirect,
    applyAssisted,
    checkout,
    creative,
    setCreative,
    seed,
    rolled,
    /** A new seed, which re-derives the idea. Clearing it returns the template. */
    roll: () => setSeed(newSeed()),
    clearRoll: () => setSeed(null),
    /**
     * Whether the picker describes the next generation rather than the open
     * document. An assisted edit derives its style from `doc.creativeMode`, so
     * changing the picker without regenerating leaves the two saying different
     * things and the UI has to admit it.
     */
    creativeAppliesToNextGeneration:
      doc != null &&
      !sameRecord(creative ?? EMPTY_RECORD, doc.creativeMode ?? EMPTY_RECORD),
  };
}

export type Engine = ReturnType<typeof useEngine>;
