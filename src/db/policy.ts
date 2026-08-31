/**
 * Per-machine policy overrides: the one layer of the cascade a user can write.
 *
 * The instance layer is where a fact about a particular box lives -- how slow
 * it is, how long queueing behind it is worth, how many calls it can take. The
 * three layers below it are repo constants, and deliberately stay that way:
 * `src/provider/registry.ts` says why the split between build-time and runtime
 * is a security boundary rather than a preference, and none of the values here
 * cross it. An override says how to treat a machine that is already reachable.
 *
 * Reports, does not gate. `loadInstancePolicies` returns whatever parsed
 * together with a description of what did not, exactly as `loadDocument` does,
 * and for the same reason: a build that refuses to start because one stored
 * number went bad has turned a wrong retry budget into a broken app. A bad
 * entry falls back to the layer below, which is the shipped default.
 *
 * Parsed per entry rather than as one object, so a single malformed machine
 * does not take the others with it.
 */

import { z } from 'zod';
import { POLICY_FIELDS, POLICY_KEYS, type Policy } from '../core/policy';
import { getSetting, setSetting } from './db';

/** One key, holding every machine's overrides by instance id. */
export const INSTANCE_POLICY_SETTING = 'instance-policy';

/**
 * A validator per attribute, built from the kind rather than restated.
 *
 * The point of deriving it: an attribute added to `Policy` gets an entry in
 * `POLICY_FIELDS` or the build fails, and getting an entry there is what gives
 * it a validator here. There is no second list to forget.
 */
function validatorFor(key: keyof Policy): z.ZodType {
  const field = POLICY_FIELDS[key];
  if (field.kind === 'text') return z.string().min(1);
  const min = 'min' in field ? field.min : undefined;
  const base = field.kind === 'integer' ? z.number().int() : z.number();
  return min != null ? base.min(min) : base;
}

/**
 * Unknown keys are dropped rather than refused.
 *
 * Zod's default for an object, and the wanted behaviour: a document written by
 * a later build that knows an attribute this one does not must still open, with
 * the attribute it does know intact. Same tolerance the creative derivations
 * have for pack ids they cannot resolve, and for the same reason -- storage
 * outlives the build that wrote it.
 */
const PolicySchema = z.object(
  Object.fromEntries(POLICY_KEYS.map((key) => [key, validatorFor(key).optional()])),
);

export interface StoredPolicies {
  /** Overrides by instance id, holding only the entries that parsed. */
  policies: Record<string, Policy>;
  /** What was dropped and why, for the UI to surface. Absent when nothing was. */
  error?: string;
}

/**
 * Parse the stored bag, keeping what is good.
 *
 * Exported because it is the whole of the trust boundary and the useEngine
 * caller around it is not reachable from a Node test -- the same irreducible
 * gap `buildClient` has, and the same answer: put the logic where a test can
 * hold it and keep the unreachable part to one line.
 */
export function parseStoredPolicies(raw: unknown): StoredPolicies {
  if (raw == null) return { policies: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { policies: {}, error: 'the stored overrides are not an object' };
  }

  const policies: Record<string, Policy> = {};
  const dropped: string[] = [];
  for (const [instanceId, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = PolicySchema.safeParse(value);
    if (parsed.success) {
      policies[instanceId] = parsed.data as Policy;
    } else {
      dropped.push(`${instanceId} (${parsed.error.issues.map((i) => i.message).join('; ')})`);
    }
  }

  return dropped.length > 0
    ? { policies, error: `overrides ignored for ${dropped.join(', ')}` }
    : { policies };
}

/** Every machine's overrides, with anything unreadable reported rather than thrown. */
export async function loadInstancePolicies(): Promise<StoredPolicies> {
  return parseStoredPolicies(await getSetting<unknown>(INSTANCE_POLICY_SETTING, null));
}

/** What a write did, and what it refused. */
export interface PolicyWrite {
  /** Every machine's overrides as they now stand, parsed. */
  policies: Record<string, Policy>;
  /** Why nothing was written, when nothing was. */
  rejected?: string;
}

/**
 * Set or clear ONE attribute on ONE machine, against what storage currently
 * holds rather than against a bag the caller captured earlier.
 *
 * Two bugs are closed by that shape, both found in review rather than by use.
 *
 * The first: the previous version took the whole parsed bag and wrote it back.
 * `parseStoredPolicies` keeps only the entries that validate, so a machine
 * holding an override this build rejects -- a later build's shape, say -- was
 * dropped from storage permanently the next time any OTHER machine was edited.
 * The load site's comment promised the opposite in as many words. Re-reading
 * the raw value here and merging into it keeps entries this build cannot parse,
 * which is what that promise actually requires.
 *
 * The second: a caller holding a stale bag could drop a sibling attribute
 * written moments earlier. Taking one attribute rather than a whole policy
 * removes the possibility instead of documenting it.
 *
 * Validation lives here, at the write, not in the control. `PolicyPanel` was
 * the only writer and it enforced neither `min` nor integer-ness, so typing -5
 * into the retry budget stored -5000: a deadline already in the past, handed to
 * the client for the rest of the session, and then rejected on the next load --
 * where it presented as storage being corrupt rather than as the control that
 * wrote it. A boundary that validates on read and not on write is not a
 * boundary.
 */
export async function setInstanceAttribute<K extends keyof Policy>(
  instanceId: string,
  key: K,
  value: Policy[K] | undefined,
): Promise<PolicyWrite> {
  const raw = await getSetting<unknown>(INSTANCE_POLICY_SETTING, null);
  const bag: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};

  if (value !== undefined) {
    const check = validatorFor(key).safeParse(value);
    if (!check.success) {
      return {
        policies: parseStoredPolicies(bag).policies,
        rejected: `${key} rejected: ${check.error.issues.map((i) => i.message).join('; ')}`,
      };
    }
  }

  const existing = bag[instanceId];
  const entry: Record<string, unknown> =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (value === undefined) delete entry[key];
  else entry[key] = value;

  // An entry with nothing left is removed rather than stored empty. `{}` and no
  // entry must not be two states, or the panel reports a machine as customised
  // to exactly its inherited values.
  if (Object.keys(entry).length === 0) delete bag[instanceId];
  else bag[instanceId] = entry;

  await setSetting(INSTANCE_POLICY_SETTING, bag);
  return { policies: parseStoredPolicies(bag).policies };
}
