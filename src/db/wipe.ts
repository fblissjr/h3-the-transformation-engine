/**
 * Erasing local state, and proving it happened.
 *
 * A delete button whose only evidence is that it did not throw is a claim, not
 * a guarantee. Three things routinely make an IndexedDB wipe silently do
 * nothing: a cached connection handle that keeps serving the old database, a
 * `deleteDatabase` blocked forever by another open tab, and a hardcoded list of
 * keys that has drifted from what the app actually writes.
 *
 * So erasing here is survey -> erase -> survey, and the second survey is a
 * fresh read of the real stores rather than a variable this module set. What
 * the UI reports is what the browser said afterwards, and `isClean` is capable
 * of returning false -- `test/wipe.test.ts` makes it do so.
 *
 * On verification by counting: after `deleteDatabase`, reopening recreates the
 * database with empty stores. That is indistinguishable from a fresh install,
 * which is the state being claimed, and counting rows is portable in a way that
 * `indexedDB.databases()` is not. The assertion is "zero rows in every store",
 * which is the part a user cares about.
 */

import { deleteDB } from 'idb';
import { closeDb, db, DB_NAME, STORES, type StoreName } from './db';
import {
  destroyVault,
  listSecretKeys,
  removeAllSecrets,
  VAULT_DB_NAME,
  vaultKeyCount,
} from '../crypto/secureStore';

/**
 * How long to wait for a blocked delete before reporting it as blocked.
 *
 * `deleteDatabase` does not fail when another tab holds the database open; it
 * waits. Waiting forever behind a spinner is worse than saying so.
 */
const BLOCKED_TIMEOUT_MS = 3_000;

export interface Residue {
  /** Row counts per store in the document database. */
  rows: Record<StoreName, number>;
  /** Wrapping keys still held in the vault. */
  vaultKeys: number;
  /** localStorage keys still under the secure prefix, by name. */
  secrets: string[];
}

export type EraseScope = 'documents' | 'everything';

export interface EraseReport {
  scope: EraseScope;
  before: Residue;
  after: Residue;
  /** Databases whose deletion did not complete, almost always another open tab. */
  blocked: string[];
  clean: boolean;
}

// ---------------------------------------------------------------------------
// Survey
// ---------------------------------------------------------------------------

export async function survey(): Promise<Residue> {
  const database = await db();
  const rows = {} as Record<StoreName, number>;
  for (const store of STORES) rows[store] = await database.count(store);

  return { rows, vaultKeys: await vaultKeyCount(), secrets: listSecretKeys() };
}

/** Total number of things a survey found, across every kind of storage. */
export function residueTotal(residue: Residue): number {
  const rows = STORES.reduce((sum, store) => sum + residue.rows[store], 0);
  return rows + residue.vaultKeys + residue.secrets.length;
}

/**
 * Whether nothing in scope remains.
 *
 * Scope matters: a "documents" erase that leaves the API key behind is correct,
 * and reporting it as unclean would train the user to ignore the readout.
 */
export function isClean(residue: Residue, scope: EraseScope): boolean {
  const noRows = STORES.every((store) => residue.rows[store] === 0);
  if (scope === 'documents') return noRows;
  return noRows && residue.vaultKeys === 0 && residue.secrets.length === 0;
}

/** Human-readable list of what is still there. Empty string when nothing is. */
export function describeResidue(residue: Residue, scope: EraseScope): string {
  const parts: string[] = [];
  for (const store of STORES) {
    if (residue.rows[store] > 0) parts.push(`${residue.rows[store]} in ${store}`);
  }
  if (scope === 'everything') {
    if (residue.vaultKeys > 0) parts.push(`${residue.vaultKeys} wrapping key`);
    if (residue.secrets.length > 0) parts.push(`${residue.secrets.length} stored secret`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Erase
// ---------------------------------------------------------------------------

/**
 * Delete a database, distinguishing "done" from "still waiting on another tab".
 *
 * The race is not a shortcut around correctness -- the survey afterwards is what
 * settles whether data is gone. It exists so a blocked delete surfaces as a
 * blocked delete instead of an interface that never comes back.
 */
async function deleteReporting(name: string): Promise<'deleted' | 'blocked'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deleteDB(name).then(() => 'deleted' as const),
      new Promise<'blocked'>((resolve) => {
        timer = setTimeout(() => resolve('blocked'), BLOCKED_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Erase local state and report what the browser looked like afterwards.
 *
 * `documents` clears the workspace, its version history, and settings, and
 * leaves the stored API key alone. `everything` additionally removes every
 * secret under the secure prefix and destroys the wrapping key, which makes any
 * `origin`-mode ciphertext that somehow survives permanently undecryptable.
 */
export async function erase(scope: EraseScope): Promise<EraseReport> {
  const before = await survey();
  const blocked: string[] = [];

  // The cached handle has to go first, or the delete waits on this tab's own
  // connection and the next read is served from a database that was deleted.
  await closeDb();
  if ((await deleteReporting(DB_NAME)) === 'blocked') blocked.push(DB_NAME);

  if (scope === 'everything') {
    removeAllSecrets();
    await destroyVault();
    // Counting reopens an empty vault, same as the document database above. A
    // non-zero count here means the delete did not take, which is the only
    // outcome worth reporting -- the next `setSecret` mints a fresh key.
    if ((await vaultKeyCount()) > 0) blocked.push(VAULT_DB_NAME);
  }

  const after = await survey();
  return { scope, before, after, blocked, clean: isClean(after, scope) && blocked.length === 0 };
}
