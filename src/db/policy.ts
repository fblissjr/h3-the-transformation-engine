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

/**
 * Write one machine's overrides, or clear them.
 *
 * An empty policy removes the entry rather than storing `{}`. The two would
 * resolve identically today, and that is exactly the problem: two encodings of
 * "nothing set here" is what makes a settings panel say a value was overridden
 * to its inherited value. Same rule `pruneGlitch` follows.
 *
 * Takes the whole bag and returns the next one, so the caller holds one piece
 * of state rather than reading storage back to find out what it now says.
 */
export async function saveInstancePolicy(
  policies: Record<string, Policy>,
  instanceId: string,
  next: Policy,
): Promise<Record<string, Policy>> {
  const updated = { ...policies };
  if (Object.keys(next).length === 0) {
    delete updated[instanceId];
  } else {
    updated[instanceId] = next;
  }
  await setSetting(INSTANCE_POLICY_SETTING, updated);
  return updated;
}
