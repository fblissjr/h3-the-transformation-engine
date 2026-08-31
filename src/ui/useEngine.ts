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
import { buildClient } from '../provider/build';
import type { InferenceClient, ProviderId } from '../provider/types';
import { listModels, loadModel, pickDefaultModel, type HeylookModel } from '../provider/heylook';
import {
  explainFor,
  heylookPolicyConfig,
  instanceFor,
  instancePolicyFor,
  policyFor,
  HEYLOOK_INSTANCES,
  PROVIDERS,
} from '../provider/registry';
import type { Policy } from '../core/policy';
import { loadInstancePolicies, saveInstancePolicy } from '../db/policy';
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
import { trace } from '../debug';

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
/**
 * Whether to let the backend enforce the reply's shape.
 *
 * Stored provider-agnostically and deliberately NOT per provider: it is a
 * property of how you want the document produced, not of who produces it, and
 * a per-provider copy would be four settings to keep in step the moment a third
 * backend arrives. A client that cannot enforce ignores it.
 */
const ENFORCE_SCHEMA_SETTING = 'enforce-schema';
/** Which configured machine to talk to. Origins are build-time; the choice is not. */
const HEYLOOK_INSTANCE_SETTING = 'heylook-instance';

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
   * One controller rather than one per action, which is only sound because
   * `generate` and `applyAssisted` both return early while `busy` is set. That
   * was asserted here before it was true: the edit button was disabled while
   * busy but the Enter key beside it was not, so a second call could overwrite
   * this ref and leave the first generation running with nothing able to stop
   * it. The guard now lives in the actions rather than in the markup, because a
   * guard per call site is one someone eventually forgets to copy.
   *
   * Stopping is provider-agnostic on purpose. `CallOptions.signal` has been on
   * the interface since it was extracted and both clients thread it through, so
   * this needed a control rather than a mechanism.
   *
   * What it does NOT do, measured rather than assumed: it does not stop the
   * generation on the server. A non-streaming request writes nothing to the
   * connection until it is finished, so the server never learns the client has
   * gone. Aborting a 73-second heylook generation at 5 seconds left the next
   * call waiting 57.9 -- the remainder. The identical abort on a streaming
   * request freed the server in 0.1s, so cancellation is real but costs
   * streaming, which this client deliberately does not do.
   */
  const abortRef = useRef<AbortController | null>(null);
  const [heylookError, setHeylookError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  /**
   * The model being made resident, while that is happening.
   *
   * Separate from `discovering` because they are different waits with different
   * answers: discovery is asking what is served, this is asking for gigabytes to
   * be read off disk. Sharing one flag would put "asking <origin>" on screen
   * during a thirty-second load.
   */
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  /**
   * On by default, which is what Gemini has always done.
   *
   * Off is the interesting setting and the reason this exists: constrained
   * decoding distorts the token distribution while the model writes, so it may
   * be costing the prose quality this project is built around. That is
   * unmeasured, and a toggle is the instrument for measuring it.
   */
  const [enforceSchema, setEnforceSchemaState] = useState(true);
  const [instanceId, setInstanceIdState] = useState<string>(HEYLOOK_INSTANCES[0].id);
  /**
   * Every machine's policy overrides, by instance id.
   *
   * The only layer of the cascade that is editable at runtime. Held as the
   * whole bag rather than the active machine's slice so that switching
   * instances needs no reload, and so a write can produce the next bag without
   * reading storage back to find out what it now says.
   */
  const [instancePolicies, setInstancePolicies] = useState<Record<string, Policy>>({});
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
   * Set the bar at the top of the window, and record that it happened.
   *
   * Traced HERE rather than in an effect on `error`, which was the first
   * attempt and is subtly incomplete: React bails out of a re-render when
   * `setError` is called with an identical string, so a failure that recurs
   * with the same message -- pressing generate twice with no key -- fired the
   * effect once and then silently never again, while the log read as a
   * complete record of what reached the screen. Recording at the decision is
   * one event per occurrence by construction.
   *
   * Clearing (`setError(null)`) deliberately stays a bare setter: an empty bar
   * is not an event.
   */
  const fail = useCallback((message: string) => {
    trace('state', 'state.error', message, { error: message }, { level: 'error' });
    setError(message);
  }, []);

  const note = useCallback((message: string) => {
    trace('state', 'state.notice', message, { notice: message }, { level: 'warn' });
    setNotice(message);
  }, []);
  /**
   * The single copy of the creative selection.
   *
   * It lives here rather than inside the picker so that a reload, a checkout
   * and an erase all put the controls and the document in the same state. A
   * picker holding its own copy agrees with this one exactly once, at mount.
   */
  const [creative, setCreativeState] = useState<CreativeModeRecord | null>(null);
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
          note('The stored API key could not be decrypted on this browser. Paste it again.');
        }
      }

      const storedProvider = await getSetting<ProviderId>(PROVIDER_SETTING, 'gemini');
      if (storedProvider === 'heylook' || storedProvider === 'gemini') {
        setProviderState(storedProvider);
      }
      const storedModel = await getSetting<string | null>(HEYLOOK_MODEL_SETTING, null);
      heylookModelIdRef.current = storedModel;
      setHeylookModelId(storedModel);
      setEnforceSchemaState(await getSetting<boolean>(ENFORCE_SCHEMA_SETTING, true));
      const storedInstance = await getSetting<string | null>(HEYLOOK_INSTANCE_SETTING, null);
      // Honoured only if this build still configures it: instance origins are
      // build-time, so a stored id can name a machine that is no longer in the
      // policy, and talking to one the CSP does not name is a silent refusal.
      if (storedInstance && HEYLOOK_INSTANCES.some((i) => i.id === storedInstance)) {
        setInstanceIdState(storedInstance);
      }

      // Reports rather than gates, the way the document schema does: an
      // override that no longer parses falls back to the layer below, which is
      // the shipped default, and the app opens either way. Entries naming a
      // machine this build no longer configures are kept rather than pruned --
      // they cost nothing, and pruning them would silently discard the settings
      // for a machine that is only temporarily out of the environment.
      const storedPolicies = await loadInstancePolicies();
      setInstancePolicies(storedPolicies.policies);
      if (storedPolicies.error) {
        const policyNotice =
          `Some stored machine settings could not be read (${storedPolicies.error}). ` +
          'The built-in defaults are in use for those.';
        // Appended for the reason the schema notice below is: the key notice
        // above says a stored key has to be pasted again, and it is not
        // something to drop because a second thing also went wrong.
        //
        // Traced as its own fragment rather than through `note`, because an
        // updater cannot be: what reaches the bar is this text joined to
        // whatever was already there, and the fragment is the event.
        trace('state', 'state.notice', policyNotice, { notice: policyNotice }, { level: 'warn' });
        setNotice((current) => (current ? `${current} ${policyNotice}` : policyNotice));
      }

      const stored = await loadDocument(DOC_ID);
      if (stored) {
        const { record, schemaError } = stored;
        setDoc(record.doc);
        setHeadVersionId(record.headVersionId);
        setSlots(record.doc.slots);
        setDurationFrames(record.doc.durationFrames);
        setDurationSeconds(record.doc.durationSeconds);
        setModeOverride(record.doc.modeLocked ? record.doc.mode : null);
        setCreativeState(restoreCreative(record.doc.creativeMode));
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
          // something to drop because a second thing also went wrong. Traced as
          // a fragment for the reason the policy notice above is.
          trace('state', 'state.notice', schemaNotice, { notice: schemaNotice }, { level: 'warn' });
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
      fail('Paste a key before saving.');
      return;
    }
    const mode: WritableKeyMode = passphrase ? 'passphrase' : DEFAULT_KEY_MODE;
    try {
      await setSecret(API_KEY_NAME, trimmed, { mode, ...(passphrase ? { passphrase } : {}) });
    } catch (cause) {
      // Storing the key can fail for real -- a browser with IndexedDB disabled
      // has nowhere to put the wrapping key. Letting that reject unhandled left
      // the form looking like it had saved when it had not.
      fail(
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
      fail('That passphrase does not unlock the stored key.');
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
    setCreativeState(null);
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
    note(
      scope === 'everything'
        ? 'Erased the workspace, its history, and the stored key.'
        : 'Erased the workspace and its history. Your API key is still stored.',
    );
    trace('state', 'state.erased', `erased: ${scope}`, { scope }, { level: 'warn' });
  }, []);

  // --- derived -----------------------------------------------------------
  const inference = useMemo(() => inferMode(slots), [slots]);
  const mode: H3Mode = modeOverride ?? inference.mode;

  /**
   * The picker's own setter, traced.
   *
   * Only the picker's path goes through here. A restore, a checkout and an
   * erase all set the same state and are traced by their own events, so
   * routing them through this too would report a user choosing a style when
   * they had opened a document.
   */
  const setCreative = useCallback((next: CreativeModeRecord | null) => {
    trace('state', 'state.creative', `creative selection: ${describeRecord(next)}`, {
      record: next,
      hasDirection: next != null && hasDirection(next),
    });
    setCreativeState(next);
  }, []);

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
  /** The machine being talked to. The only source of a heylook origin. */
  const instance = useMemo(() => instanceFor(instanceId), [instanceId]);

  const refreshHeylookModels = useCallback(async () => {
    setDiscovering(true);
    setHeylookError(null);
    try {
      // A bounded wait, because the only control that could retry is disabled
      // while this runs. An origin that resolves but never answers -- a machine
      // that is up with nothing listening on the port -- otherwise leaves the
      // panel saying "asking ..." with no way out but a reload. The post path
      // has had a budget for this class of failure since backpressure; this had
      // none.
      const models = await listModels(instance.origin, AbortSignal.timeout(20_000));
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
          note(
            `heylook is no longer serving ${current}. Selected ${replacement ?? 'nothing'} instead.`,
          );
        }
        heylookModelIdRef.current = replacement;
        setHeylookModelId(replacement);
        // Persisted, or the stored row keeps naming the model that has gone:
        // every reload would re-discover it missing and show the same notice
        // again, and a first-time user's auto-picked model was never remembered
        // at all. `setHeylookModel` was the only writer and only the picker
        // reached it.
        if (replacement != null) void setSetting(HEYLOOK_MODEL_SETTING, replacement);
      }
      if (models.length === 0) {
        setHeylookError(
          `heylook at ${instance.origin} is running but serving no models. Point it at a model ` +
            'folder, or download one.',
        );
      }
    } catch (cause) {
      setHeylookModels([]);
      const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
      // Traced here rather than inside `listModels`, which fails at five
      // different throw sites. Without it a failed discovery left the log
      // showing a request with no outcome at all -- found by opening the panel
      // against a server that was not running, which is the commonest state
      // this feature exists to explain.
      trace(
        'provider',
        'provider.discovery.error',
        `heylook discovery failed at ${instance.origin}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { origin: instance.origin, timedOut, cause },
        { level: 'error' },
      );
      setHeylookError(
        timedOut
          ? `heylook at ${instance.origin} accepted the connection but did not answer within 20 ` +
              'seconds. The address is reachable, so this is more likely the wrong port than the ' +
              'wrong host.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setDiscovering(false);
    }
  }, [instance]);

  // Discover on switching to heylook, and once on load if that is the stored
  // choice. Not on an interval: the roster only changes when the owner does
  // something, and there is a refresh button for that.
  useEffect(() => {
    if (provider !== 'heylook' || heylookModels != null) return;
    void refreshHeylookModels();
  }, [provider, heylookModels, refreshHeylookModels]);

  const setProvider = useCallback((next: ProviderId) => {
    trace('state', 'state.provider', `provider is now ${next}`, {
      provider: next,
      canEnforceSchema: PROVIDERS[next].canEnforceSchema,
    });
    setProviderState(next);
    setError(null);
    void setSetting(PROVIDER_SETTING, next);
  }, []);

  const setInstanceId = useCallback((next: string) => {
    trace('state', 'state.instance', `instance is now ${next}`, {
      instance: next,
      origin: instanceFor(next).origin,
    });
    setInstanceIdState(next);
    setHeylookModels(null); // a different machine serves a different roster
    void setSetting(HEYLOOK_INSTANCE_SETTING, next);
  }, []);

  const setEnforceSchema = useCallback((next: boolean) => {
    trace('state', 'state.enforceSchema', `schema enforcement ${next ? 'on' : 'off'}`, {
      enforceSchema: next,
    });
    setEnforceSchemaState(next);
    void setSetting(ENFORCE_SCHEMA_SETTING, next);
  }, []);

  const setHeylookModel = useCallback(
    (id: string) => {
      trace('state', 'state.model', `heylook model is now ${id}`, { model: id });
      heylookModelIdRef.current = id;
      setHeylookModelId(id);
      void setSetting(HEYLOOK_MODEL_SETTING, id);

      // Ask for it to be made resident now, so the cold load happens against a
      // control the user just touched rather than inside the first generate,
      // where it is indistinguishable from a hung server -- nothing is written
      // to the connection while a model loads.
      //
      // Nothing here can fail the selection. The model is chosen either way and
      // the generate that follows resolves the provider itself; this only
      // decides whether the wait is legible. So every outcome is a notice.
      void (async () => {
        setLoadingModel(id);
        try {
          const outcome = await loadModel(instance.origin, id);
          if (outcome.kind === 'busy') {
            // The one backpressure message worth quoting: it names the model
            // that is generating, and this app has a stop button for it.
            setNotice(
              `${id} could not be loaded yet -- ${outcome.detail} It will load when the ` +
                'server is free, or you can stop the run that is holding it.',
            );
          } else if (outcome.kind === 'rejected') {
            setNotice(
              `heylook would not load ${id}: ${outcome.detail} Refresh the model list; the ` +
                'roster may have changed.',
            );
          }
          // `unreachable` is deliberately silent. Discovery already reports an
          // unreachable server in its own words, and a second notice saying the
          // same thing in different words reads as two faults.
        } finally {
          setLoadingModel(null);
        }
      })();
    },
    [instance],
  );

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
  /**
   * The effective policy for the active backend.
   *
   * Resolved through the cascade rather than read from any one place, so a
   * value can be stated wherever it is actually known -- language globally,
   * retry budget per provider type, concurrency per machine -- without every
   * layer having to state all of it.
   */
  /**
   * This machine's overrides, or nothing when the active provider has none.
   *
   * Resolved by a pure function in the registry rather than indexed inline, so
   * the span from a stored override to the client config it becomes is
   * reachable by a test. `test/registry.test.ts` walks it; what no test here can
   * reach is this hook handing the bag over, which is the same irreducible
   * remainder `buildClient` has.
   */
  const instancePolicy = useMemo<Policy>(
    () => instancePolicyFor(provider, instance, instancePolicies),
    [provider, instance, instancePolicies],
  );

  const policy = useMemo<Policy>(
    () => policyFor(provider, instancePolicy),
    [provider, instancePolicy],
  );

  /**
   * Write this machine's overrides, or clear one by omitting it.
   *
   * Takes the whole next policy rather than a patch, so clearing an attribute
   * and setting it are the same call. An empty policy drops the entry entirely
   * -- `{}` and no entry must not be two states, or the panel reports a machine
   * as customised to exactly its inherited values.
   */
  const setInstancePolicy = useCallback(
    (next: Policy) => {
      const target = instance.id;
      void (async () => {
        setInstancePolicies(await saveInstancePolicy(instancePolicies, target, next));
      })();
    },
    [instance, instancePolicies],
  );

  const client = useMemo<InferenceClient | null>(
    () =>
      // Constructed by a pure function rather than inline, so the wiring inside
      // it -- the policy mapping, and the `instrument` wrap that feeds the debug
      // console's provider channel -- is reachable by a test. Inline, deleting
      // the wrap left every debug test green and the panel silent.
      buildClient({
        provider,
        apiKey,
        origin: instance.origin,
        model: heylookModel,
        // Mapped by a pure function in the registry rather than inline, so the
        // join between policy and client is reachable by a test.
        ...heylookPolicyConfig(policy),
      }),
    [provider, apiKey, heylookModel, policy, instance],
  );

  /** Why the generate button cannot fire, in this provider's terms. */
  const notReady = useMemo(() => {
    if (client) return null;
    if (provider === 'gemini') return 'Add a Gemini API key first.';
    if (discovering) return 'Still asking heylook what it is serving.';
    return heylookError ?? `Choose a model on heylook at ${instance.origin} first.`;
  }, [client, provider, discovering, heylookError, instance]);

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
      trace('state', 'state.commit', `head is now ${version.id} "${label}"`, {
        versionId: version.id,
        parentId: headVersionId,
        label,
        changedPaths: (operations ?? []).map((o) => o.path),
      });
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
      note('Stopped. Nothing was saved -- a stopped call returns no document.');
      return;
    }
    fail(cause instanceof Error ? cause.message : String(cause));
  }, []);

  /**
   * Stop the call in flight.
   *
   * Ends the wait and returns the UI. On a local server that serialises work the
   * generation carries on to the end regardless -- see the note on `abortRef`.
   */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // --- actions -----------------------------------------------------------
  const generate = useCallback(async () => {
    if (busy) return;
    if (!client) return fail(notReady ?? 'No inference backend is ready.');
    if (effectiveIdea.trim() === '') return fail('Describe what you want before generating.');
    trace('state', 'state.generate', `generate on ${client.providerId}`, {
      provider: client.providerId,
      mode: input.mode,
      enforceSchema,
      seed,
      rolled: rolled != null,
      creative: describeRecord(creative),
      slots: slots.length,
    });
    setBusy('Planning');
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await compile(client, input, {
        id: DOC_ID,
        signal: controller.signal,
        enforceSchema,
      });
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
  }, [busy, client, notReady, effectiveIdea, input, commit, creative, rolled, seed, reportOrStopped, enforceSchema]);

  const applyDirect = useCallback(
    async (path: string, value: unknown) => {
      if (!doc) return;
      const result = editDirect(doc, path, value);
      if (result.patch.rejected.length > 0) {
        fail(result.patch.rejected[0].reason);
        return;
      }
      await commit(result.doc, `Edited ${path}`, result.patch.applied);
    },
    [doc, commit],
  );

  const applyAssisted = useCallback(
    async (instruction: string) => {
      // Enforced here rather than at the call sites. The button was disabled
      // while busy and the Enter handler beside it was not, so a second call
      // could start, overwrite the single `abortRef`, and leave the first
      // generation running with nothing able to stop it -- falsifying the
      // invariant `abortRef`'s own comment claims.
      if (busy) return;
      if (!client) return fail(notReady ?? 'No inference backend is ready.');
      if (!doc) return;
      if (selectedPaths.length === 0) return fail('Select something to edit first.');
      trace('state', 'state.applyAssisted', `assisted edit of ${selectedPaths.length} path(s)`, {
        provider: client.providerId,
        paths: selectedPaths,
        instruction,
        enforceSchema,
      });
      setBusy('Editing');
      setError(null);
      setNotice(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await edit(client, doc, selectedPaths, instruction, {
          signal: controller.signal,
          enforceSchema,
        });
        if (result.patch.applied.length === 0) {
          fail(
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
        if (skipped.length > 0) note(`Applied ${result.patch.applied.length}. Skipped: ${skipped.join('; ')}`);
      } catch (cause) {
        reportOrStopped(cause);
      } finally {
        abortRef.current = null;
        setBusy(null);
      }
    },
    [busy, client, notReady, doc, selectedPaths, commit, reportOrStopped, enforceSchema],
  );

  const checkout = useCallback(async (version: StoredVersion) => {
    setDoc(version.doc);
    setHeadVersionId(version.id);
    setSlots(version.doc.slots);
    setCreativeState(restoreCreative(version.doc.creativeMode));
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
    note(`Checked out "${version.label}". Editing from here will branch.`);
    trace('state', 'state.checkout', `checked out ${version.id} "${version.label}"`, {
      versionId: version.id,
      label: version.label,
      // The document's own record, restored into the picker. It is what the
      // open prose was written under, which is not necessarily what the next
      // generation would use -- the badge exists because those differ.
      creativeMode: version.doc.creativeMode ?? null,
      seed: version.doc.roll?.seed ?? null,
    });
  }, []);

  const togglePath = useCallback((path: string, additive: boolean) => {
    // The path and the modifier, not the resulting set: the set is computed
    // inside the updater, and an updater has to stay pure -- React is free to
    // run it twice, which would log the click twice.
    trace('state', 'state.select', `${additive ? 'toggled' : 'selected'} ${path}`, { path, additive });
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
    heylookOrigin: instance.origin,
    instanceId,
    setInstanceId,
    instances: HEYLOOK_INSTANCES,
    heylookModels,
    heylookModelId,
    setHeylookModel,
    heylookError,
    discovering,
    /** Non-null while a model is being made resident, naming which. */
    loadingModel,
    enforceSchema,
    setEnforceSchema,
    /** The effective policy, and where each value came from. */
    policy,
    policyExplained: explainFor(provider, instancePolicy),
    /** What this machine states for itself, which is the only editable layer. */
    instancePolicy,
    setInstancePolicy,
    /**
     * Whether the active backend can honour it. Read from the provider rather
     * than from a constructed client, which does not exist before a key is
     * unlocked or a model chosen -- and reporting "cannot constrain decoding"
     * in that state was both wrong and the most-seen state in the app.
     */
    canEnforceSchema: PROVIDERS[provider].canEnforceSchema,
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
