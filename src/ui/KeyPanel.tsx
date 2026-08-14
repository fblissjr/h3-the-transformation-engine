/**
 * API key entry.
 *
 * Paste a key, save it, done. No CLI, no environment variable, no password
 * manager -- those are how a developer feeds the probe script, not how someone
 * uses the app.
 *
 * Three states, because a passphrase-protected key that exists but has not been
 * unlocked is not the same as no key at all. Collapsing them would prompt the
 * user to paste their key again and overwrite a perfectly good stored one.
 */

import { useState } from 'react';
import type { KeyMode } from '../crypto/secureStore';

interface Props {
  apiKey: string | null;
  storedKeyMode: KeyMode | null;
  onSave: (key: string, passphrase?: string) => Promise<void>;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onForget: () => void;
}

export function KeyPanel({ apiKey, storedKeyMode, onSave, onUnlock, onForget }: Props) {
  const [editing, setEditing] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(false);

  const reset = () => {
    setKeyDraft('');
    setPassphrase('');
    setUsePassphrase(false);
    setEditing(false);
  };

  // --- unlocked, not editing --------------------------------------------
  if (apiKey && !editing) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
        <span>
          key ····{apiKey.slice(-4)}
          <span className="ml-1">
            {storedKeyMode === 'passphrase' ? '(passphrase)' : '(this device only)'}
          </span>
        </span>
        <button type="button" onClick={() => setEditing(true)} className="underline">
          change
        </button>
        <button
          type="button"
          onClick={() => {
            onForget();
            reset();
          }}
          className="underline"
        >
          remove
        </button>
      </div>
    );
  }

  // --- stored but locked --------------------------------------------------
  if (!apiKey && storedKeyMode === 'passphrase' && !editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(ev) => {
          ev.preventDefault();
          void onUnlock(passphrase).then((ok) => ok && setPassphrase(''));
        }}
      >
        <input
          type="password"
          value={passphrase}
          onChange={(ev) => setPassphrase(ev.target.value)}
          placeholder="Passphrase to unlock your key"
          className="w-56 rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
        />
        <button type="submit" className="rounded border border-[var(--color-edge)] px-2 py-1 text-xs hover:bg-white/5">
          Unlock
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[10px] text-[var(--color-muted)] underline"
        >
          use a different key
        </button>
      </form>
    );
  }

  // --- entering a key -----------------------------------------------------
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(ev) => {
        ev.preventDefault();
        void onSave(keyDraft, usePassphrase && passphrase ? passphrase : undefined).then(reset);
      }}
    >
      <input
        type="password"
        value={keyDraft}
        onChange={(ev) => setKeyDraft(ev.target.value)}
        placeholder="Gemini API key"
        autoComplete="off"
        className="w-56 rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
      />

      <label
        className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]"
        title="Without a passphrase the key is only obfuscated in localStorage -- anyone with the same browser and locale can read it."
      >
        <input
          type="checkbox"
          checked={usePassphrase}
          onChange={(ev) => setUsePassphrase(ev.target.checked)}
        />
        protect
      </label>

      {usePassphrase && (
        <input
          type="password"
          value={passphrase}
          onChange={(ev) => setPassphrase(ev.target.value)}
          placeholder="Passphrase"
          autoComplete="new-password"
          className="w-36 rounded border border-[var(--color-edge)] bg-black/30 px-2 py-1 text-xs"
        />
      )}

      <button type="submit" className="rounded border border-[var(--color-edge)] px-2 py-1 text-xs hover:bg-white/5">
        Save
      </button>

      {(apiKey || storedKeyMode) && (
        <button type="button" onClick={reset} className="text-[10px] text-[var(--color-muted)] underline">
          cancel
        </button>
      )}
    </form>
  );
}
