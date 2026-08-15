/**
 * What the API key's at-rest storage actually provides.
 *
 * The README makes three claims a user could act on: that `origin` mode cannot
 * be undone by copying the localStorage blob elsewhere, that `passphrase` mode
 * is real secrecy, and that the legacy `device` mode is not. Each is asserted
 * here, and each assertion is paired with the case that would falsify it -- a
 * round-trip test alone would pass just as happily against a key derived from
 * a public string, which is the exact thing this replaced.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
globalThis.localStorage = new MemoryStorage() as unknown as Storage;
// Node exposes `navigator` as a getter-only global, so it has to be redefined
// rather than assigned. Fixing the value also keeps the legacy-mode fixtures
// below reproducible across machines.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'probe/1.0', language: 'en-GB' } as Navigator,
  configurable: true,
});
globalThis.btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s: string) => Buffer.from(s, 'base64').toString('binary');

const {
  API_KEY_NAME,
  DEFAULT_KEY_MODE,
  destroyVault,
  getSecret,
  hasSecret,
  removeAllSecrets,
  secretMode,
  setSecret,
  vaultKeyCount,
} = await import('../src/crypto/secureStore');

const KEY = 'AIza-not-a-real-key';

beforeEach(async () => {
  localStorage.clear();
  await destroyVault();
});

describe('the default mode', () => {
  it('is origin, not the legacy fingerprint', async () => {
    expect(DEFAULT_KEY_MODE).toBe('origin');
    await setSecret(API_KEY_NAME, KEY);
    expect(secretMode(API_KEY_NAME)).toBe('origin');
  });

  it('round-trips the key', async () => {
    await setSecret(API_KEY_NAME, KEY);
    expect(await getSecret(API_KEY_NAME)).toBe(KEY);
  });

  it('refuses to write the legacy device mode', async () => {
    // Read support for old values must not become a way to produce new ones.
    // `tsc` rejects this call, which is the real guard -- the cast reaches past
    // it to check the runtime backstop an untyped caller would hit.
    const illegal = { mode: 'device' } as unknown as Parameters<typeof setSecret>[2];
    await expect(setSecret(API_KEY_NAME, KEY, illegal)).rejects.toThrow(/legacy/);
  });
});

describe('origin mode is bound to something that cannot leave the browser', () => {
  it('holds a wrapping key that refuses to export', async () => {
    await setSecret(API_KEY_NAME, KEY);
    expect(await vaultKeyCount()).toBe(1);

    // Opened without a version on purpose: naming one couples the test to a
    // repair history it should not know about, which is what the source stopped
    // doing two describes down.
    const { openDB } = await import('idb');
    const vault = await openDB('H3KeyVault');
    const wrapper = (await vault.get('wrapping', 'apiKeyWrapper')) as CryptoKey;
    vault.close();

    // This is the whole claim. If the bytes could be exported they could be
    // copied into another profile, and the binding would be decorative.
    expect(wrapper.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', wrapper)).rejects.toThrow();
  });

  it('leaves the ciphertext undecryptable once the vault is gone', async () => {
    await setSecret(API_KEY_NAME, KEY);
    const blob = localStorage.getItem('h3-secure:gemini-api-key');

    await destroyVault();

    // The blob is untouched -- this is not passing because the data vanished.
    expect(localStorage.getItem('h3-secure:gemini-api-key')).toBe(blob);
    expect(hasSecret(API_KEY_NAME)).toBe(true);
    expect(await getSecret(API_KEY_NAME)).toBeNull();
  });

  it('does not mint a replacement key on a failed read', async () => {
    // Silently generating a new wrapper would turn "permanently unreadable"
    // into a decrypt failure that looks recoverable, and would leave a fresh
    // key behind after an erase.
    await setSecret(API_KEY_NAME, KEY);
    await destroyVault();
    await getSecret(API_KEY_NAME);
    expect(await vaultKeyCount()).toBe(0);
  });

  it('does not reuse an IV across writes', async () => {
    const ivs = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      await setSecret(API_KEY_NAME, KEY);
      ivs.add(JSON.parse(localStorage.getItem('h3-secure:gemini-api-key')!).iv);
    }
    expect(ivs.size).toBe(5);
  });
});

describe('a vault database that exists without its object store', () => {
  /**
   * Reproduces a wedge hit for real while testing in Chrome. Anything else on
   * this origin calling `indexedDB.open('H3KeyVault')` creates the database at
   * version 1 with no stores; `openDB(name, 1, ...)` then never runs its
   * upgrade, and without healing every later call throws NotFoundError forever.
   */
  async function createEmptyVaultAtVersion1(): Promise<void> {
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('H3KeyVault', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // The precondition is the point: version 1, no stores, exactly what a
    // stray `indexedDB.open` on this origin leaves behind.
    expect(raw.version).toBe(1);
    expect([...raw.objectStoreNames]).toEqual([]);
    raw.close();
  }

  it('is repaired rather than throwing forever', async () => {
    await createEmptyVaultAtVersion1();

    await setSecret(API_KEY_NAME, KEY);
    expect(await getSecret(API_KEY_NAME)).toBe(KEY);
    expect(await vaultKeyCount()).toBe(1);
  });

  it('does not throw when merely counting', async () => {
    await createEmptyVaultAtVersion1();
    expect(await vaultKeyCount()).toBe(0);
  });
});

describe('passphrase mode', () => {
  it('opens with the right passphrase', async () => {
    await setSecret(API_KEY_NAME, KEY, { mode: 'passphrase', passphrase: 'correct horse' });
    expect(secretMode(API_KEY_NAME)).toBe('passphrase');
    expect(await getSecret(API_KEY_NAME, 'correct horse')).toBe(KEY);
  });

  it('stays shut with the wrong one, and with none', async () => {
    await setSecret(API_KEY_NAME, KEY, { mode: 'passphrase', passphrase: 'correct horse' });
    expect(await getSecret(API_KEY_NAME, 'incorrect horse')).toBeNull();
    expect(await getSecret(API_KEY_NAME)).toBeNull();
  });

  it('does not fall back to the vault', async () => {
    // A passphrase envelope must never be readable by the origin-mode path.
    await setSecret(API_KEY_NAME, KEY, { mode: 'passphrase', passphrase: 'correct horse' });
    expect(await vaultKeyCount()).toBe(0);
    expect(await getSecret(API_KEY_NAME)).toBeNull();
  });

  it('requires a passphrase to write', async () => {
    await expect(setSecret(API_KEY_NAME, KEY, { mode: 'passphrase' })).rejects.toThrow(/passphrase/i);
  });
});

describe('legacy device values', () => {
  /** Byte-identical to what the old default wrote: PBKDF2 over UA + locale. */
  async function writeLegacyEnvelope(value: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(`${navigator.userAgent}|${navigator.language}`),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(value),
    );
    localStorage.setItem(
      'h3-secure:gemini-api-key',
      JSON.stringify({
        mode: 'device',
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
        iv: btoa(String.fromCharCode(...iv)),
        salt: btoa(String.fromCharCode(...salt)),
        expiresAt: null,
      }),
    );
  }

  it('still decrypt, so nobody silently loses a stored key', async () => {
    await writeLegacyEnvelope(KEY);
    expect(secretMode(API_KEY_NAME)).toBe('device');
    expect(await getSecret(API_KEY_NAME)).toBe(KEY);
  });

  it('are undone by public information, which is why they are legacy', async () => {
    // The point of the mode change, stated as a test: the fingerprint is not a
    // secret, so anyone who knows the user agent and locale opens the blob.
    await writeLegacyEnvelope(KEY);
    const envelope = JSON.parse(localStorage.getItem('h3-secure:gemini-api-key')!);
    const bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('probe/1.0|en-GB'), // guessed, not obtained
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(envelope.salt), iterations: 310_000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes(envelope.iv) },
      key,
      bytes(envelope.ciphertext),
    );
    expect(new TextDecoder().decode(plain)).toBe(KEY);
  });
});

describe('bulk removal', () => {
  it('takes every secret under the prefix and nothing else', async () => {
    await setSecret(API_KEY_NAME, KEY);
    localStorage.setItem('h3-secure:another', '{}');
    localStorage.setItem('unrelated', 'keep me');

    expect(removeAllSecrets().sort()).toEqual(['h3-secure:another', 'h3-secure:gemini-api-key']);
    expect(localStorage.getItem('unrelated')).toBe('keep me');
    expect(hasSecret(API_KEY_NAME)).toBe(false);
  });
});
