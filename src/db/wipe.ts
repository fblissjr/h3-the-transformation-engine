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
import { eraseServer, surveyServer, type ServerTable } from './db';
import {
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
  /**
   * Row counts per table, as the server reports them.
   *
   * `runs` is among them and it is the one that matters most: `raw_output`
   * holds prompt text, so a survey that skipped it would let this button report
   * a clean erase while every prompt sat on the server's disk.
   */
  rows: Record<ServerTable, number>;
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

/**
 * What is still stored, across both halves.
 *
 * The documents are the server's and the key vault is the browser's, so this
 * asks each for its own counts. Neither can answer for the other, which is why
 * the report has two kinds of number in it rather than one.
 */
export async function survey(): Promise<Residue> {
  return {
    rows: await surveyServer(),
    vaultKeys: await vaultKeyCount(),
    secrets: listSecretKeys(),
  };
}

/** The tables the survey covers, read off whatever the server reported. */
const tablesOf = (rows: Record<string, number>) => Object.keys(rows) as ServerTable[];

/** Total number of things a survey found, across every kind of storage. */
export function residueTotal(residue: Residue): number {
  const rows = tablesOf(residue.rows).reduce((sum, t) => sum + residue.rows[t], 0);
  return rows + residue.vaultKeys + residue.secrets.length;
}

/**
 * Whether nothing in scope remains.
 *
 * Scope matters: a "documents" erase that leaves the API key behind is correct,
 * and reporting it as unclean would train the user to ignore the readout.
 */
export function isClean(residue: Residue, scope: EraseScope): boolean {
  const noRows = tablesOf(residue.rows).every((t) => residue.rows[t] === 0);
  if (scope === 'documents') return noRows;
  return noRows && residue.vaultKeys === 0 && residue.secrets.length === 0;
}

/** Human-readable list of what is still there. Empty string when nothing is. */
export function describeResidue(residue: Residue, scope: EraseScope): string {
  const parts: string[] = [];
  for (const table of tablesOf(residue.rows)) {
    if (residue.rows[table] > 0) parts.push(`${residue.rows[table]} in ${table}`);
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
 *
 * It now guards the VAULT rather than the document store. The documents moved
 * to the server, whose delete has its own failure mode and cannot be held open
 * by another tab; the vault is still IndexedDB in this browser, so it is still
 * the thing a second tab can block.
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

  // The server deletes its own rows and re-reads its own counts. It reports
  // what storage says rather than that the statement ran, which is the property
  // most at risk of being lost across a process boundary -- and a row that
  // survived has to reach the user as data, not as an exception the button
  // cannot describe.
  await eraseServer();

  if (scope === 'everything') {
    removeAllSecrets();
    if ((await deleteReporting(VAULT_DB_NAME)) === 'blocked') blocked.push(VAULT_DB_NAME);
    // Counting reopens an empty vault, same as the document database above. A
    // non-zero count here means the delete did not take, which is the only
    // outcome worth reporting -- the next `setSecret` mints a fresh key.
    if ((await vaultKeyCount()) > 0 && !blocked.includes(VAULT_DB_NAME)) {
      blocked.push(VAULT_DB_NAME);
    }
  }

  const after = await survey();
  return { scope, before, after, blocked, clean: isClean(after, scope) && blocked.length === 0 };
}
