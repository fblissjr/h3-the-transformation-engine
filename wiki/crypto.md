# Cryptographic Key Management & Storage Security

[Documentation Index](index.md) | [Architecture](architecture.md) | [Database & Version Lifecycle](db.md) | [UI & State Management](ui.md) | [Telemetry & Debugging](debug.md) | [Provider Layer](provider.md)

---

## 1. Overview & Threat Model

The H3 Transformation Engine stores sensitive secrets (such as Google Gemini API keys) entirely on the client side (`src/crypto/secureStore.ts`). It employs the Web Cryptography API (`crypto.subtle`) for authenticated encryption using AES-GCM-256.

The cryptographic subsystem is designed around an explicit threat model:
- **What it protects against:** Offline extraction of browser storage dumps, theft of `localStorage` strings, or accidental leakage in log exports.
- **What it does NOT protect against:** Active Cross-Site Scripting (XSS) or malicious code running inside the same origin. An attacker with JavaScript execution privileges in the origin context can invoke `getSecret()` or inspect memory after a secret is unlocked. No browser-based storage scheme can prevent same-origin memory access.

To address the threat of offline storage extraction, `src/crypto/secureStore.ts` implements three key derivation modes, dynamic database healing, and structured envelope serialization.

```
+-----------------------------------------------------------------------------------+
|                               Key Management Modes                                |
+------------------------------------+----------------------------------------------+
| origin (Default)                   | passphrase                                   |
| - AES-GCM-256 wrapping key         | - User-supplied passphrase                   |
| - extractable: false               | - PBKDF2-HMAC-SHA256 (310,000 iterations)    |
| - Held in IndexedDB H3KeyVault     | - 16-byte random salt                        |
| - Non-extractable from JS memory   | - Survives browser profile compromise        |
+------------------------------------+----------------------------------------------+
| device (Legacy, Decrypt-Only)                                                     |
| - Obfuscation based on navigator.userAgent and navigator.language                 |
| - Write prohibited (throws Error; excluded from WritableKeyMode)                  |
| - Automatically upgraded to origin on next write                                  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Key Management Modes

The storage subsystem supports three modes defined by the `KeyMode` union type:
```typescript
export type KeyMode = 'origin' | 'passphrase' | 'device';
export type WritableKeyMode = Exclude<KeyMode, 'device'>;
export const DEFAULT_KEY_MODE: WritableKeyMode = 'origin';
```

### 2.1 `origin` Mode (Default)

In `origin` mode, the cryptographic key is generated directly inside the browser's cryptographic engine:
```typescript
const fresh = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  false, // extractable: false
  ['encrypt', 'decrypt'],
);
```

**Security Characteristics:**
- **Non-Extractable:** Because `extractable: false` is set, `crypto.subtle.exportKey` rejects with an error. The raw key bytes never enter JavaScript heap memory.
- **IndexedDB Storage:** A `CryptoKey` object is structured-cloneable and is stored in a dedicated IndexedDB database named `VAULT_DB_NAME` ('H3KeyVault') inside object store `wrapping` under key 'apiKeyWrapper'.
- **Browser Binding:** The wrapping key is bound to the origin and browser profile by browser storage partitioning. A stolen `localStorage` export cannot be decrypted on another machine or in another browser profile.

### 2.2 `passphrase` Mode

In `passphrase` mode, the user supplies a passphrase when storing and retrieving secrets.
- **Key Derivation:** The key is derived using PBKDF2-HMAC-SHA256 with 310,000 iterations (`PBKDF2_ITERATIONS = 310_000`), complying with OWASP password storage recommendations.
- **Per-Envelope Salt:** A fresh 16-byte cryptographically secure pseudo-random salt (`crypto.getRandomValues(new Uint8Array(16))`) is generated for every encryption operation and stored inside the ciphertext envelope.
- **Profile Independence:** This mode protects against an attacker who captures the complete browser profile and disk image. Without the user's secret passphrase, the stored ciphertext cannot be decrypted.

### 2.3 `device` Mode (Legacy, Decrypt-Only)

Historically, earlier builds derived an AES key from `${navigator.userAgent}|${navigator.language}`.
- **Vulnerability Identified:** The user-agent and language headers are not secrets; anyone running the same browser version and operating system locale can compute identical key material. This provided obfuscation rather than genuine encryption.
- **Strict Deprecation:** `device` is excluded from `WritableKeyMode`. Attempting to write in `device` mode throws a runtime `Error` (`"device mode is legacy and read-only. Use origin or passphrase."`).
- **Seamless Upgrade:** Existing stored secrets written in `device` mode still decrypt so users do not lose access to their credentials. Upon saving a new key or updating an existing one, the storage layer automatically upgrades the entry to `DEFAULT_KEY_MODE` (`'origin'`).

---

## 3. Dynamic Vault Healing

The key vault ('H3KeyVault') requires resilient database initialization to avoid static schema upgrade traps.

### 3.1 The Version 1 Upgrade Trap

Standard IndexedDB initialization typically calls `openDB(VAULT_DB_NAME, 1, { upgrade })`. However, if another script on the same origin (or an automated test harness) issues a probe such as `indexedDB.open('H3KeyVault')`, an empty database is created at version 1 without the `wrapping` object store.

Under the IndexedDB specification:
- Calling `openDB(VAULT_DB_NAME, 1)` on an existing version 1 database skips the `upgrade` callback completely because the requested version is not strictly greater than the current version.
- Subsequent operations throw 'NotFoundError' whenever the code attempts to access the missing `wrapping` store.
- If the application subsequently tries to repair this by requesting version 1 again, it hits a deadlock.

### 3.2 Dynamic Healing Implementation

To eliminate this vulnerability, the internal `vault()` function never specifies a fixed version number:

```typescript
async function vault(): Promise<IDBPDatabase> {
  const database = await openDB(VAULT_DB_NAME);
  if (database.objectStoreNames.contains(VAULT_STORE)) return database;

  const next = database.version + 1;
  database.close();
  return openDB(VAULT_DB_NAME, next, { upgrade: createStore });
}
```

- `vault()` opens whatever database version currently exists.
- It verifies whether object store `wrapping` (`VAULT_STORE`) is present.
- If missing, it immediately closes the connection, increments the version by 1 (`next = database.version + 1`), and runs `createStore` inside a versionchange transaction.
- A newly initialized vault database settles cleanly at version 2, immune to prior empty database probes.

---

## 4. Envelope Specification & Storage Layout

Encrypted secrets are stored in `localStorage` under a prefixed key namespace:
- `PREFIX = 'h3-secure:'`
- Primary credential key: `API_KEY_NAME = 'gemini-api-key'`, stored as `h3-secure:gemini-api-key`.

### 4.1 Envelope Interface

The encrypted payload is serialized as a JSON object:

```typescript
interface Envelope {
  mode: KeyMode;
  ciphertext: string; // Base64-encoded ciphertext
  iv: string;         // Base64-encoded 12-byte initialization vector
  salt?: string;      // Base64-encoded 16-byte salt (PBKDF2 modes only)
  expiresAt: number | null; // Timestamp in milliseconds or null
}
```

- **Initialization Vector (IV):** A 12-byte random IV is generated for every encryption pass via `crypto.getRandomValues(new Uint8Array(12))`.
- **Base64 Encoding:** Binary buffers (`Uint8Array`, `ArrayBuffer`) are converted to base64 using `toBase64` and restored using `fromBase64`.
- **Time-to-Live (TTL):** Optional `ttlMs` parameter allows callers to set expiration dates. Upon reading an expired envelope, `getSecret()` deletes the key and returns `null`.

---

## 5. Public API Reference

The cryptographic subsystem exports the following functions in `src/crypto/secureStore.ts`:

### 5.1 Storing & Retrieving Secrets

- `setSecret(name: string, value: string, options?: StoreOptions): Promise<void>`:
  Encrypts `value` with the chosen `WritableKeyMode` (`origin` or `passphrase`), writes the envelope to `localStorage`, and updates IndexedDB wrapping keys if needed.
- `getSecret(name: string, passphrase?: string): Promise<string | null>`:
  Reads and decrypts the secret. Returns `null` if the key does not exist, has expired, or if decryption fails.
  
  *Defensive Design:* Decryption failures return `null` instead of throwing cryptographic errors. This covers three routine scenarios: a wrong passphrase, a legacy `device` entry read after a browser update changed the user-agent, or an `origin` secret whose vault was wiped. In all three cases, returning `null` prompts the UI to cleanly request the key again.

### 5.2 Secret Lifecycle & Querying

- `removeSecret(name: string): void`: Removes the key from `localStorage`.
- `hasSecret(name: string): boolean`: Returns `true` if the prefixed key exists in `localStorage`.
- `secretMode(name: string): KeyMode | null`: Inspects the envelope without decrypting to determine whether the secret is encrypted with `origin`, `passphrase`, or `device`.
- `listSecretKeys(): string[]`: Scans `localStorage` and returns all keys matching `PREFIX = 'h3-secure:'`.
- `removeAllSecrets(): string[]`: Deletes all `h3-secure:*` entries from `localStorage` and returns the removed key list.

### 5.3 Vault Management

- `destroyVault(): Promise<void>`: Calls `deleteDB(VAULT_DB_NAME)` to delete the IndexedDB key vault database. This renders all existing `origin`-mode secrets permanently undecryptable.
- `vaultKeyCount(): Promise<number>`: Counts the number of wrapping keys stored in the vault without creating new ones.

---

## 6. Related Articles & Cross-References

- [Documentation Index](index.md): Master catalog of all LLM-wiki articles.
- [Architecture & Pipeline](architecture.md): High-level system design and subsystem boundaries.
- [Database & Version Lifecycle](db.md): Document persistence, schema healing, and two-phase storage wipes.
- [UI & State Management](ui.md): Integration with `KeyPanel.tsx` and application state.
- [Telemetry & Debugging](debug.md): Automatic pre-buffer redaction of secrets in `redact.ts`.
- [Provider Layer](provider.md): Secure credential consumption by `GeminiClient`.
