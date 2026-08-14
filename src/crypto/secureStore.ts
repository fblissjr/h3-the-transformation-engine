/**
 * At-rest storage for the API key.
 *
 * Ported from the-transformation-engine's `encryptedStorage`, with one honest
 * correction. The original derived its AES key from
 * `navigator.userAgent + navigator.language`, and the project described the
 * result as "encrypted (AES-GCM)". The cipher is real, but the key is not
 * secret: anyone with the same browser build and locale can derive it and read
 * the blob. That is obfuscation, and calling it encryption overstates it.
 *
 * So there are two modes, named for what they actually provide:
 *
 *  - `device`  -- the original behaviour. Stops a casual look at localStorage
 *                 and nothing more. The default, because it needs no prompt.
 *  - `passphrase` -- a user-supplied secret. Real confidentiality at rest, at
 *                 the cost of entering it once per session.
 *
 * Neither protects against script running on the page. If an attacker executes
 * JavaScript in this origin, they can read the key after it is decrypted, and
 * no storage scheme changes that.
 */

const PREFIX = 'h3-secure:';
const PBKDF2_ITERATIONS = 310_000; // OWASP guidance for PBKDF2-HMAC-SHA256

export type KeyMode = 'device' | 'passphrase';

interface Envelope {
  mode: KeyMode;
  ciphertext: string;
  iv: string;
  salt: string;
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

/**
 * Key material for the two modes.
 *
 * The device fingerprint is deliberately the same one the original used. It is
 * not a secret and the docstring says so; changing it would only have made
 * existing stored values unreadable without making them safer.
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

export interface StoreOptions {
  mode?: KeyMode;
  passphrase?: string;
  /** Milliseconds. Omitted means it persists until explicitly removed. */
  ttlMs?: number;
}

export async function setSecret(name: string, value: string, options: StoreOptions = {}): Promise<void> {
  const mode = options.mode ?? 'device';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(mode, salt, options.passphrase);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(value),
  );

  const envelope: Envelope = {
    mode,
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    salt: toBase64(salt),
    expiresAt: options.ttlMs != null ? Date.now() + options.ttlMs : null,
  };
  localStorage.setItem(PREFIX + name, JSON.stringify(envelope));
}

/**
 * Read a secret. Returns null when absent, expired, or undecryptable.
 *
 * A failed decrypt is treated as absent rather than thrown: the common cause is
 * a device-mode value being read after a browser update changed the user agent,
 * and the correct response to that is to ask for the key again, not to show a
 * crypto error.
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
    const key = await deriveKey(envelope.mode, fromBase64(envelope.salt), passphrase);
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

export const API_KEY_NAME = 'gemini-api-key';
