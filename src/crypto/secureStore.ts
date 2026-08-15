/**
 * At-rest storage for the API key.
 *
 * The cipher was never the weak part. AES-GCM-256 is fine; the question is
 * always what the decryption key is made of and who else can make it.
 *
 * Three modes, named for what they actually provide:
 *
 *  - `origin`     -- the default. A random AES-GCM-256 key generated with
 *                    `extractable: false` and stored as a `CryptoKey` in
 *                    IndexedDB. Its bytes are never exposed to JavaScript, so
 *                    there is nothing to copy out: the blob in localStorage can
 *                    only be decrypted by code running on this origin, in this
 *                    browser profile. That binding is enforced by the browser's
 *                    storage partitioning and by the key being unexportable --
 *                    not by a secret, because there isn't one to keep.
 *  - `passphrase` -- a user-supplied secret, PBKDF2-stretched. The only mode
 *                    that survives an attacker holding the whole browser
 *                    profile, and the only one whose security does not depend
 *                    on the machine.
 *  - `device`     -- LEGACY, decrypt-only. Derived the AES key from
 *                    `navigator.userAgent + navigator.language`, which is not a
 *                    secret: anyone with the same browser build and locale can
 *                    derive it and read the blob. That is obfuscation, and it
 *                    is no longer written. Existing values still decrypt so
 *                    nobody silently loses a stored key; the next save upgrades
 *                    them to `origin`.
 *
 * What none of them do: stop script already running on this origin. An attacker
 * executing JavaScript here can call `getSecret` exactly like the app does, or
 * read the key out of memory after it is unlocked. `origin` mode raises the
 * floor for a stolen localStorage dump; it does not change that ceiling, and no
 * storage scheme does.
 */

import { deleteDB, openDB, type IDBPDatabase } from 'idb';

const PREFIX = 'h3-secure:';
const PBKDF2_ITERATIONS = 310_000; // OWASP guidance for PBKDF2-HMAC-SHA256

/**
 * The wrapping key lives in its own database rather than alongside documents.
 * Two reasons: `src/crypto` should not depend on the document schema, and
 * "erase my documents" and "erase my key" have to be separately answerable.
 */
export const VAULT_DB_NAME = 'H3KeyVault';
const VAULT_STORE = 'wrapping';
const VAULT_KEY = 'apiKeyWrapper';

export type KeyMode = 'origin' | 'passphrase' | 'device';

/**
 * The modes a caller may write.
 *
 * `device` is readable but not writable, and saying so in the type means
 * `tsc` rejects `{ mode: 'device' }` at build time rather than the app throwing
 * at the moment someone saves their key. The runtime check in `setSecret`
 * stays as a backstop for callers that are not typed.
 */
export type WritableKeyMode = Exclude<KeyMode, 'device'>;

/** What a fresh save uses when the caller does not ask for a passphrase. */
export const DEFAULT_KEY_MODE: WritableKeyMode = 'origin';

interface Envelope {
  mode: KeyMode;
  ciphertext: string;
  iv: string;
  /** Only meaningful for the PBKDF2 modes. Absent on `origin` envelopes. */
  salt?: string;
  expiresAt: number | null;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// origin mode: an unexportable key the browser holds for us
// ---------------------------------------------------------------------------

const createStore = (database: IDBPDatabase) => {
  if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE);
};

/**
 * Open the vault, healing a database that exists without the store.
 *
 * Opening at a fixed version is the wrong primitive twice over. `openDB(name,
 * 1, ...)` runs `upgrade` only when the existing version is below 1, so a
 * `H3KeyVault` sitting at version 1 with no object store never gets one and
 * every later call throws `NotFoundError` -- the app can never save a key again
 * and nothing says why. That is not hypothetical: anything else on this origin
 * calling `indexedDB.open('H3KeyVault')` creates exactly that database, which is
 * the shared-origin hazard the README warns about, and it happened once while
 * testing this. Asking for version 1 again *after* a repair then fails the
 * other way, with `VersionError`.
 *
 * So the version is never named. Open whatever is there, and treat the presence
 * of the store -- not the version number -- as the thing that matters, bumping
 * only when it is missing. The number is an implementation detail; a fresh
 * vault settles at 2.
 */
async function vault(): Promise<IDBPDatabase> {
  const database = await openDB(VAULT_DB_NAME);
  if (database.objectStoreNames.contains(VAULT_STORE)) return database;

  const next = database.version + 1;
  database.close();
  return openDB(VAULT_DB_NAME, next, { upgrade: createStore });
}

/**
 * Fetch the wrapping key, generating one on first use.
 *
 * `extractable: false` is the whole point. `crypto.subtle.exportKey` on this
 * key rejects, which means the bytes cannot be serialised, logged, copied into
 * another profile, or carried off in a storage dump -- only used, and only from
 * code the browser considers same-origin. A `CryptoKey` is structured-cloneable,
 * so IndexedDB can hold the handle across reloads without ever materialising
 * the material.
 *
 * `create: false` is how a *read* asks for the key without conjuring a new one:
 * if the vault was erased, the stored ciphertext is permanently unreadable, and
 * silently minting a fresh key would turn that into a confusing decrypt failure
 * instead of an honest "it is gone".
 */
async function wrappingKey(create: boolean): Promise<CryptoKey | null> {
  const database = await vault();
  try {
    const existing = (await database.get(VAULT_STORE, VAULT_KEY)) as CryptoKey | undefined;
    if (existing) return existing;
    if (!create) return null;

    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await database.put(VAULT_STORE, fresh, VAULT_KEY);
    return fresh;
  } finally {
    database.close();
  }
}

/** Destroy the wrapping key. Every `origin`-mode secret becomes unreadable. */
export async function destroyVault(): Promise<void> {
  await deleteDB(VAULT_DB_NAME);
}

/** Whether a wrapping key currently exists, without creating one. */
export async function vaultKeyCount(): Promise<number> {
  const database = await vault();
  try {
    return await database.count(VAULT_STORE);
  } finally {
    database.close();
  }
}

// ---------------------------------------------------------------------------
// PBKDF2 modes
// ---------------------------------------------------------------------------

/**
 * Key material for the two derived modes.
 *
 * The `device` fingerprint is kept byte-identical to what the old default wrote,
 * because its only remaining job is decrypting values that already exist.
 */
function keyMaterialFor(mode: KeyMode, passphrase?: string): string {
  if (mode === 'passphrase') {
    if (!passphrase) throw new Error('Passphrase mode requires a passphrase.');
    return passphrase;
  }
  return `${navigator.userAgent}|${navigator.language}`;
}

async function deriveKey(mode: KeyMode, salt: Uint8Array, passphrase?: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(keyMaterialFor(mode, passphrase)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface StoreOptions {
  mode?: WritableKeyMode;
  passphrase?: string;
  /** Milliseconds. Omitted means it persists until explicitly removed. */
  ttlMs?: number;
}

export async function setSecret(name: string, value: string, options: StoreOptions = {}): Promise<void> {
  const mode: WritableKeyMode = options.mode ?? DEFAULT_KEY_MODE;
  if ((mode as KeyMode) === 'device') {
    // Unreachable through the type, kept for callers that are not typed.
    // Writing this mode again would re-create the obfuscation the default was
    // changed to escape. Reading it is supported; producing it is not.
    throw new Error('device mode is legacy and read-only. Use origin or passphrase.');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  let key: CryptoKey;
  let salt: Uint8Array | null = null;

  if (mode === 'origin') {
    const wrapper = await wrappingKey(true);
    if (!wrapper) throw new Error('Could not create a wrapping key in this browser.');
    key = wrapper;
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(mode, salt, options.passphrase);
  }

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(value),
  );

  const envelope: Envelope = {
    mode,
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    ...(salt ? { salt: toBase64(salt) } : {}),
    expiresAt: options.ttlMs != null ? Date.now() + options.ttlMs : null,
  };
  localStorage.setItem(PREFIX + name, JSON.stringify(envelope));
}

/**
 * Read a secret. Returns null when absent, expired, or undecryptable.
 *
 * A failed decrypt is treated as absent rather than thrown. There are three
 * ordinary causes -- a wrong passphrase, a legacy `device` value read after a
 * browser update changed the user agent, and an `origin` value whose vault was
 * erased -- and the right response to all three is to ask for the key again,
 * not to show a crypto error.
 */
export async function getSecret(name: string, passphrase?: string): Promise<string | null> {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;

  let envelope: Envelope;
  try {
    envelope = JSON.parse(raw) as Envelope;
  } catch {
    return null;
  }

  if (envelope.expiresAt != null && Date.now() > envelope.expiresAt) {
    localStorage.removeItem(PREFIX + name);
    return null;
  }

  try {
    let key: CryptoKey | null;
    if (envelope.mode === 'origin') {
      key = await wrappingKey(false);
    } else {
      if (!envelope.salt) return null;
      key = await deriveKey(envelope.mode, fromBase64(envelope.salt), passphrase);
    }
    if (!key) return null;

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv) as BufferSource },
      key,
      fromBase64(envelope.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function removeSecret(name: string): void {
  localStorage.removeItem(PREFIX + name);
}

export function hasSecret(name: string): boolean {
  return localStorage.getItem(PREFIX + name) != null;
}

/** Which mode a stored secret uses, so the UI knows whether to prompt. */
export function secretMode(name: string): KeyMode | null {
  const raw = localStorage.getItem(PREFIX + name);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as Envelope).mode;
  } catch {
    return null;
  }
}

/**
 * Every localStorage key this module owns.
 *
 * Scanned by prefix rather than assembled from a list of known names, so an
 * "erase everything" cannot quietly miss a secret some other code path wrote.
 */
export function listSecretKeys(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) out.push(key);
  }
  return out.sort();
}

/** Remove every secret this module owns. Returns the keys it removed. */
export function removeAllSecrets(): string[] {
  const keys = listSecretKeys();
  for (const key of keys) localStorage.removeItem(key);
  return keys;
}

export const API_KEY_NAME = 'gemini-api-key';
